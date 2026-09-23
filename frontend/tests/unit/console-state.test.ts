import { describe, expect, it } from "vitest";
import {
  consoleReducer,
  initialConsoleState,
  progressPercent,
  selectedGeneration,
  SESSION_LIMIT,
  type ConsoleState,
  type Draft,
  type Generation,
} from "@/lib/console-state";

const draft: Draft = { prompt: "graphite lattice", steps: 30, guidance: 7.5, size: 1024, seed: null };

function generation(id: string): Generation {
  return {
    id,
    image: "data:image/png;base64,AA==",
    seed: 1,
    params: { prompt: "p", num_inference_steps: 30, guidance_scale: 7.5, width: 1024, height: 1024, scheduler: "euler_a" },
    timingMs: 3000,
    model: "m",
  };
}

function reduce(state: ConsoleState, ...actions: Parameters<typeof consoleReducer>[1][]) {
  return actions.reduce(consoleReducer, state);
}

describe("consoleReducer", () => {
  it("walks the happy path: start, accepted, progress, succeeded", () => {
    const state = reduce(
      initialConsoleState,
      { type: "start", draft },
      { type: "accepted", seed: 99, totalSteps: 30 },
      { type: "progress", step: 12, totalSteps: 30 },
    );
    expect(state.status).toEqual({ kind: "generating", draft, seed: 99, step: 12, totalSteps: 30 });

    const done = consoleReducer(state, { type: "succeeded", generation: generation("a") });
    expect(done.status).toEqual({ kind: "result", id: "a" });
    expect(selectedGeneration(done)?.id).toBe("a");
  });

  it("keeps the failed draft so the error view can retry it", () => {
    const state = reduce(
      initialConsoleState,
      { type: "start", draft },
      { type: "failed", failure: { code: "ERR_COLD_START", message: "warming", status: 503, retryAfterSeconds: 20 } },
    );
    expect(state.status).toMatchObject({ kind: "error", draft, code: "ERR_COLD_START", retryAfterSeconds: 20 });
  });

  it("ignores stream events that arrive outside a generation", () => {
    expect(consoleReducer(initialConsoleState, { type: "progress", step: 3, totalSteps: 30 })).toBe(initialConsoleState);
    expect(consoleReducer(initialConsoleState, { type: "succeeded", generation: generation("a") })).toBe(initialConsoleState);
  });

  it("cancels back to the latest result, or idle when there is none", () => {
    const idle = reduce(initialConsoleState, { type: "start", draft }, { type: "cancelled" });
    expect(idle.status).toEqual({ kind: "idle" });

    const withResult = reduce(
      initialConsoleState,
      { type: "start", draft },
      { type: "succeeded", generation: generation("a") },
      { type: "start", draft },
      { type: "cancelled" },
    );
    expect(withResult.status).toEqual({ kind: "result", id: "a" });
  });

  it("orders the session newest first and caps its length", () => {
    let state = initialConsoleState;
    for (let i = 0; i < SESSION_LIMIT + 3; i++) {
      state = reduce(state, { type: "start", draft }, { type: "succeeded", generation: generation(`g${i}`) });
    }
    expect(state.generations).toHaveLength(SESSION_LIMIT);
    expect(state.generations[0].id).toBe(`g${SESSION_LIMIT + 2}`);
  });

  it("selects past generations but not while generating or for unknown ids", () => {
    const state = reduce(
      initialConsoleState,
      { type: "start", draft },
      { type: "succeeded", generation: generation("a") },
      { type: "start", draft },
      { type: "succeeded", generation: generation("b") },
    );
    expect(consoleReducer(state, { type: "select", id: "a" }).status).toEqual({ kind: "result", id: "a" });
    expect(consoleReducer(state, { type: "select", id: "zzz" })).toBe(state);

    const generating = consoleReducer(state, { type: "start", draft });
    expect(consoleReducer(generating, { type: "select", id: "a" })).toBe(generating);
    expect(consoleReducer(generating, { type: "reset" })).toBe(generating);
  });
});

describe("progressPercent", () => {
  it("rounds and clamps", () => {
    expect(progressPercent(0, 30)).toBe(0);
    expect(progressPercent(19, 30)).toBe(63);
    expect(progressPercent(30, 30)).toBe(100);
    expect(progressPercent(40, 30)).toBe(100);
    expect(progressPercent(1, 0)).toBe(0);
  });
});
