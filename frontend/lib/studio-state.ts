import {
  DEFAULT_SIZE,
  LIMITS,
  sizePresetById,
  type AppliedParams,
  type GenerateRequestInput,
  type GeneratedImage,
  type SizeId,
} from "@/lib/contract";

/**
 * The studio's state: threads of generation turns, like a chat history.
 *
 * Pure and framework-free so the reducer is unit tested directly; the
 * `useStudio` hook wires it to the network and to persistence.
 */

/** The run settings in the right-hand panel. `seed: null` means a new random seed each run. */
export type Settings = {
  negativePrompt: string;
  steps: number;
  guidance: number;
  sizeId: SizeId;
  numImages: number;
  seed: number | null;
};

export const DEFAULT_SETTINGS: Settings = {
  negativePrompt: "",
  steps: LIMITS.steps.default,
  guidance: LIMITS.guidance.default,
  sizeId: DEFAULT_SIZE.id,
  numImages: LIMITS.images.default,
  seed: null,
};

/** Everything needed to run (or re-run) one generation. */
export type TurnRequest = Settings & { prompt: string };

export type GenerationFailure = {
  code: string;
  message: string;
  status: number | null;
  retryAfterSeconds: number | null;
};

export type Turn = {
  id: string;
  createdAt: number;
  request: TurnRequest;
  status: "generating" | "done" | "error";
  step: number;
  totalSteps: number;
  /** The base seed, known once the server accepts the request. */
  seed: number | null;
  images: GeneratedImage[];
  params: AppliedParams | null;
  timingMs: number | null;
  failure: GenerationFailure | null;
};

export type Thread = {
  id: string;
  /** The first prompt, which names the thread in the sidebar. */
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: Turn[];
};

export type StudioState = {
  /** False until saved threads have loaded from the browser. */
  hydrated: boolean;
  /** Most recently updated first. */
  threads: Thread[];
  /** `null` is a new, empty thread (the explore page). */
  activeThreadId: string | null;
  /** The one generation in flight; the GPU runs one at a time. */
  running: { threadId: string; turnId: string } | null;
  /** Bumped on every change worth saving, so persistence skips per-step progress. */
  revision: number;
};

export type StudioAction =
  | { type: "hydrate"; threads: Thread[]; activeThreadId: string | null }
  | { type: "new-thread" }
  | { type: "select"; threadId: string }
  | { type: "start"; threadId: string | null; newThreadId: string; turnId: string; now: number; request: TurnRequest }
  | { type: "retry"; turnId: string; now: number }
  | { type: "accepted"; seed: number; totalSteps: number }
  | { type: "progress"; step: number; totalSteps: number }
  | { type: "succeeded"; images: GeneratedImage[]; params: AppliedParams; timingMs: number; now: number }
  | { type: "failed"; failure: GenerationFailure; now: number }
  | { type: "cancelled" }
  | { type: "delete-thread"; threadId: string }
  | { type: "restore-thread"; thread: Thread };

/** Saved history is capped so browser storage cannot grow without bound. */
export const MAX_THREADS = 100;

export const initialStudioState: StudioState = {
  hydrated: false,
  threads: [],
  activeThreadId: null,
  running: null,
  revision: 0,
};

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "hydrate": {
      if (state.hydrated) return state;
      // Keep anything created before loading finished, then the saved threads.
      const known = new Set(state.threads.map((thread) => thread.id));
      const threads = sortThreads([...state.threads, ...action.threads.filter((thread) => !known.has(thread.id))]);
      const activeThreadId =
        state.activeThreadId ?? (threads.some((thread) => thread.id === action.activeThreadId) ? action.activeThreadId : null);
      return { ...state, hydrated: true, threads: threads.slice(0, MAX_THREADS), activeThreadId };
    }

    case "new-thread":
      return { ...state, activeThreadId: null };

    case "select":
      if (!state.threads.some((thread) => thread.id === action.threadId)) return state;
      return { ...state, activeThreadId: action.threadId };

    case "start": {
      if (state.running) return state;
      const turn = newTurn(action.turnId, action.now, action.request);
      const existing = action.threadId ? state.threads.find((thread) => thread.id === action.threadId) : undefined;
      const thread: Thread = existing
        ? { ...existing, updatedAt: action.now, turns: [...existing.turns, turn] }
        : { id: action.newThreadId, title: threadTitle(action.request.prompt), createdAt: action.now, updatedAt: action.now, turns: [turn] };
      return {
        ...state,
        threads: sortThreads([thread, ...state.threads.filter((other) => other.id !== thread.id)]).slice(0, MAX_THREADS),
        activeThreadId: thread.id,
        running: { threadId: thread.id, turnId: turn.id },
        revision: state.revision + 1,
      };
    }

    case "retry": {
      if (state.running) return state;
      const thread = state.threads.find((candidate) => candidate.turns.some((turn) => turn.id === action.turnId));
      const turn = thread?.turns.find((candidate) => candidate.id === action.turnId);
      if (!thread || !turn || turn.status !== "error") return state;
      const restarted = newTurn(turn.id, turn.createdAt, turn.request);
      return {
        ...updateTurn(state, thread.id, turn.id, () => restarted, action.now),
        activeThreadId: thread.id,
        running: { threadId: thread.id, turnId: turn.id },
      };
    }

    case "accepted":
      return patchRunning(state, (turn) => ({ ...turn, seed: action.seed, totalSteps: action.totalSteps }));

    case "progress":
      return patchRunning(state, (turn) => ({ ...turn, step: action.step, totalSteps: action.totalSteps }));

    case "succeeded": {
      if (!state.running) return state;
      const { threadId, turnId } = state.running;
      const next = updateTurn(
        state,
        threadId,
        turnId,
        (turn) => ({
          ...turn,
          status: "done",
          step: turn.totalSteps,
          seed: action.images[0]?.seed ?? turn.seed,
          images: action.images,
          params: action.params,
          timingMs: action.timingMs,
        }),
        action.now,
      );
      return { ...next, running: null };
    }

    case "failed": {
      if (!state.running) return state;
      const { threadId, turnId } = state.running;
      const next = updateTurn(state, threadId, turnId, (turn) => ({ ...turn, status: "error", failure: action.failure }), action.now);
      return { ...next, running: null };
    }

    case "cancelled": {
      if (!state.running) return state;
      const { threadId, turnId } = state.running;
      const thread = state.threads.find((candidate) => candidate.id === threadId);
      if (!thread) return { ...state, running: null };
      const turns = thread.turns.filter((turn) => turn.id !== turnId);
      // A cancelled first turn leaves nothing worth keeping in the sidebar.
      if (turns.length === 0) {
        return {
          ...state,
          threads: state.threads.filter((candidate) => candidate.id !== threadId),
          activeThreadId: state.activeThreadId === threadId ? null : state.activeThreadId,
          running: null,
          revision: state.revision + 1,
        };
      }
      return {
        ...state,
        threads: state.threads.map((candidate) => (candidate.id === threadId ? { ...candidate, turns } : candidate)),
        running: null,
        revision: state.revision + 1,
      };
    }

    case "delete-thread": {
      if (state.running?.threadId === action.threadId) return state;
      if (!state.threads.some((thread) => thread.id === action.threadId)) return state;
      return {
        ...state,
        threads: state.threads.filter((thread) => thread.id !== action.threadId),
        activeThreadId: state.activeThreadId === action.threadId ? null : state.activeThreadId,
        revision: state.revision + 1,
      };
    }

    case "restore-thread":
      if (state.threads.some((thread) => thread.id === action.thread.id)) return state;
      return {
        ...state,
        threads: sortThreads([action.thread, ...state.threads]).slice(0, MAX_THREADS),
        revision: state.revision + 1,
      };
  }
}

function newTurn(id: string, createdAt: number, request: TurnRequest): Turn {
  return {
    id,
    createdAt,
    request,
    status: "generating",
    step: 0,
    totalSteps: request.steps,
    seed: request.seed,
    images: [],
    params: null,
    timingMs: null,
    failure: null,
  };
}

function patchRunning(state: StudioState, patch: (turn: Turn) => Turn): StudioState {
  if (!state.running) return state;
  const { threadId, turnId } = state.running;
  return {
    ...state,
    threads: state.threads.map((thread) =>
      thread.id === threadId
        ? { ...thread, turns: thread.turns.map((turn) => (turn.id === turnId ? patch(turn) : turn)) }
        : thread,
    ),
  };
}

function updateTurn(state: StudioState, threadId: string, turnId: string, update: (turn: Turn) => Turn, now: number): StudioState {
  const threads = state.threads.map((thread) =>
    thread.id === threadId
      ? { ...thread, updatedAt: now, turns: thread.turns.map((turn) => (turn.id === turnId ? update(turn) : turn)) }
      : thread,
  );
  return { ...state, threads: sortThreads(threads), revision: state.revision + 1 };
}

function sortThreads(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A thread is named after its first prompt, on one line. */
export function threadTitle(prompt: string): string {
  return prompt.replace(/\s+/g, " ").trim();
}

export function activeThread(state: StudioState): Thread | null {
  return state.threads.find((thread) => thread.id === state.activeThreadId) ?? null;
}

export function runningTurn(state: StudioState): Turn | null {
  if (!state.running) return null;
  const { threadId, turnId } = state.running;
  return state.threads.find((thread) => thread.id === threadId)?.turns.find((turn) => turn.id === turnId) ?? null;
}

/** Threads as saved: finished turns only, since an in-flight generation cannot survive a reload. */
export function persistableThreads(threads: Thread[]): Thread[] {
  return threads
    .map((thread) => ({ ...thread, turns: thread.turns.filter((turn) => turn.status !== "generating") }))
    .filter((thread) => thread.turns.length > 0);
}

export type ThreadGroup = { label: string; threads: Thread[] };

/** Sidebar grouping by last activity: Today, Previous 7 days, Older. */
export function groupThreads(threads: Thread[], now: number): ThreadGroup[] {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const weekAgo = startOfToday - 7 * 24 * 60 * 60 * 1000;
  const groups: ThreadGroup[] = [
    { label: "Today", threads: [] },
    { label: "Previous 7 days", threads: [] },
    { label: "Older", threads: [] },
  ];
  for (const thread of threads) {
    const group = thread.updatedAt >= startOfToday ? 0 : thread.updatedAt >= weekAgo ? 1 : 2;
    groups[group].threads.push(thread);
  }
  return groups.filter((group) => group.threads.length > 0);
}

export function requestToInput(request: TurnRequest): GenerateRequestInput {
  const size = sizePresetById(request.sizeId);
  const negative = request.negativePrompt.trim();
  return {
    prompt: request.prompt,
    ...(negative ? { negative_prompt: negative } : {}),
    num_inference_steps: request.steps,
    guidance_scale: request.guidance,
    width: size.width,
    height: size.height,
    num_images: request.numImages,
    ...(request.seed === null ? {} : { seed: request.seed }),
  };
}

/** Percent complete for the progress readout, 0-100. */
export function progressPercent(step: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.min(100, Math.round((step / totalSteps) * 100));
}
