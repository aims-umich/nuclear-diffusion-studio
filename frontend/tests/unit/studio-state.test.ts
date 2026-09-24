import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  MAX_THREADS,
  groupThreads,
  initialStudioState,
  persistableThreads,
  progressPercent,
  requestToInput,
  runningTurn,
  studioReducer,
  threadTitle,
  type StudioAction,
  type StudioState,
  type Thread,
  type TurnRequest,
} from "@/lib/studio-state";

const request: TurnRequest = { ...DEFAULT_SETTINGS, prompt: "Containment dome at dusk" };
const params = {
  prompt: request.prompt,
  num_inference_steps: 50,
  guidance_scale: 5,
  width: 1024,
  height: 1024,
  num_images: 1,
  scheduler: "euler",
  prompt_truncated: false,
  negative_prompt_truncated: false,
};
const images = [{ image: "data:image/png;base64,AA==", seed: 42 }];
const failure = { code: "ERR_INFERENCE", message: "boom", status: 200, retryAfterSeconds: null };

function reduce(state: StudioState, ...actions: StudioAction[]) {
  return actions.reduce(studioReducer, state);
}

const hydrated = reduce(initialStudioState, { type: "hydrate", threads: [], activeThreadId: null });

function start(state: StudioState, turnId = "turn-1", now = 1000, threadId = state.activeThreadId) {
  return studioReducer(state, { type: "start", threadId, newThreadId: `thread-${turnId}`, turnId, now, request });
}

function finished(state: StudioState, now = 2000) {
  return studioReducer(state, { type: "succeeded", images, params, timingMs: 3200, now });
}

describe("studioReducer", () => {
  it("starts a new thread named after the first prompt", () => {
    const state = start(hydrated);
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0]).toMatchObject({ id: "thread-turn-1", title: "Containment dome at dusk" });
    expect(state.activeThreadId).toBe("thread-turn-1");
    expect(runningTurn(state)).toMatchObject({ id: "turn-1", status: "generating", step: 0, totalSteps: 50 });
  });

  it("tracks acceptance and progress without bumping the saved revision", () => {
    const started = start(hydrated);
    const state = reduce(started, { type: "accepted", seed: 42, totalSteps: 50 }, { type: "progress", step: 7, totalSteps: 50 });
    expect(runningTurn(state)).toMatchObject({ seed: 42, step: 7 });
    expect(state.revision).toBe(started.revision);
  });

  it("records a finished turn and frees the GPU slot", () => {
    const state = finished(start(hydrated));
    expect(state.running).toBeNull();
    expect(state.threads[0].turns[0]).toMatchObject({ status: "done", images, params, timingMs: 3200, seed: 42 });
    expect(state.threads[0].updatedAt).toBe(2000);
  });

  it("appends later turns to the open thread", () => {
    const state = finished(start(finished(start(hydrated)), "turn-2", 3000), 4000);
    expect(state.threads).toHaveLength(1);
    expect(state.threads[0].turns.map((turn) => turn.id)).toEqual(["turn-1", "turn-2"]);
  });

  it("runs one generation at a time", () => {
    const state = start(hydrated);
    expect(start(state, "turn-2")).toBe(state);
  });

  it("keeps a failed turn and retries it in place", () => {
    const failed = studioReducer(start(hydrated), { type: "failed", failure, now: 2000 });
    expect(failed.running).toBeNull();
    expect(failed.threads[0].turns[0]).toMatchObject({ status: "error", failure });

    const retried = studioReducer(failed, { type: "retry", turnId: "turn-1", now: 3000 });
    expect(runningTurn(retried)).toMatchObject({ id: "turn-1", status: "generating", failure: null });
    expect(retried.threads[0].turns).toHaveLength(1);
  });

  it("drops a cancelled turn, and the thread with it when that was its only turn", () => {
    const cancelledFirst = studioReducer(start(hydrated), { type: "cancelled" });
    expect(cancelledFirst.threads).toEqual([]);
    expect(cancelledFirst.activeThreadId).toBeNull();

    const cancelledSecond = studioReducer(start(finished(start(hydrated)), "turn-2", 3000), { type: "cancelled" });
    expect(cancelledSecond.threads[0].turns.map((turn) => turn.id)).toEqual(["turn-1"]);
    expect(cancelledSecond.running).toBeNull();
  });

  it("switches threads, and a new thread clears the selection", () => {
    const two = finished(start(studioReducer(finished(start(hydrated)), { type: "new-thread" }), "turn-2", 3000), 4000);
    expect(two.threads.map((thread) => thread.id)).toEqual(["thread-turn-2", "thread-turn-1"]);
    expect(studioReducer(two, { type: "select", threadId: "thread-turn-1" }).activeThreadId).toBe("thread-turn-1");
    expect(studioReducer(two, { type: "select", threadId: "missing" })).toBe(two);
    expect(studioReducer(two, { type: "new-thread" }).activeThreadId).toBeNull();
  });

  it("deletes and restores a thread, but never the one generating", () => {
    const done = finished(start(hydrated));
    const deleted = studioReducer(done, { type: "delete-thread", threadId: "thread-turn-1" });
    expect(deleted.threads).toEqual([]);
    expect(deleted.activeThreadId).toBeNull();
    expect(studioReducer(deleted, { type: "restore-thread", thread: done.threads[0] }).threads).toEqual(done.threads);

    const busy = start(hydrated);
    expect(studioReducer(busy, { type: "delete-thread", threadId: "thread-turn-1" })).toBe(busy);
  });

  it("hydrates saved threads once, keeping anything started before loading finished", () => {
    const saved: Thread = { id: "saved", title: "Saved", createdAt: 1, updatedAt: 1, turns: [] };
    const early = start(initialStudioState);
    const state = studioReducer(early, { type: "hydrate", threads: [saved], activeThreadId: "saved" });
    expect(state.hydrated).toBe(true);
    expect(state.threads.map((thread) => thread.id)).toEqual(["thread-turn-1", "saved"]);
    expect(state.activeThreadId).toBe("thread-turn-1");
    expect(studioReducer(state, { type: "hydrate", threads: [], activeThreadId: null })).toBe(state);

    const fresh = studioReducer(initialStudioState, { type: "hydrate", threads: [saved], activeThreadId: "saved" });
    expect(fresh.activeThreadId).toBe("saved");
    expect(studioReducer(initialStudioState, { type: "hydrate", threads: [saved], activeThreadId: "gone" }).activeThreadId).toBeNull();
  });

  it("caps saved history", () => {
    const threads: Thread[] = Array.from({ length: MAX_THREADS + 5 }, (_, index) => ({
      id: `t${index}`,
      title: "t",
      createdAt: index,
      updatedAt: index,
      turns: [],
    }));
    const state = studioReducer(initialStudioState, { type: "hydrate", threads, activeThreadId: null });
    expect(state.threads).toHaveLength(MAX_THREADS);
    expect(state.threads[0].id).toBe(`t${MAX_THREADS + 4}`);
  });
});

describe("helpers", () => {
  it("saves only finished turns", () => {
    const withRunning = start(finished(start(hydrated)), "turn-2", 3000);
    expect(persistableThreads(withRunning.threads)[0].turns.map((turn) => turn.id)).toEqual(["turn-1"]);
    expect(persistableThreads(start(hydrated).threads)).toEqual([]);
  });

  it("maps a turn request onto the wire contract", () => {
    expect(requestToInput({ ...request, sizeId: "16:9", numImages: 3, seed: 9, negativePrompt: "  blurry " })).toEqual({
      prompt: "Containment dome at dusk",
      negative_prompt: "blurry",
      num_inference_steps: 50,
      guidance_scale: 5,
      width: 1344,
      height: 768,
      num_images: 3,
      seed: 9,
    });
    expect(requestToInput(request)).not.toHaveProperty("seed");
    expect(requestToInput(request)).not.toHaveProperty("negative_prompt");
  });

  it("groups threads by last activity", () => {
    const now = new Date(2026, 8, 24, 15).getTime();
    const at = (daysAgo: number): Thread => ({
      id: String(daysAgo),
      title: "",
      createdAt: 0,
      updatedAt: now - daysAgo * 86_400_000,
      turns: [],
    });
    const groups = groupThreads([at(0), at(2), at(30)], now);
    expect(groups.map((group) => [group.label, group.threads.map((thread) => thread.id)])).toEqual([
      ["Today", ["0"]],
      ["Previous 7 days", ["2"]],
      ["Older", ["30"]],
    ]);
  });

  it("titles a thread with its prompt on one line", () => {
    expect(threadTitle("  Cooling towers\n in   fog ")).toBe("Cooling towers in fog");
  });

  it("computes progress", () => {
    expect(progressPercent(0, 0)).toBe(0);
    expect(progressPercent(25, 50)).toBe(50);
    expect(progressPercent(60, 50)).toBe(100);
  });
});
