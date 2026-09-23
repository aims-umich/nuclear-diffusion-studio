import type { AppliedParams, ImageSize } from "@/lib/contract";

/** What the composer submits. `seed: null` means "pick a random seed". */
export type Draft = {
  prompt: string;
  steps: number;
  guidance: number;
  size: ImageSize;
  seed: number | null;
};

export type Generation = {
  id: string;
  image: string;
  seed: number;
  params: AppliedParams;
  timingMs: number;
  model: string;
};

export type GenerationFailure = {
  code: string;
  message: string;
  status: number | null;
  retryAfterSeconds: number | null;
};

export type Status =
  | { kind: "idle" }
  | { kind: "generating"; draft: Draft; seed: number | null; step: number; totalSteps: number }
  | { kind: "result"; id: string }
  | ({ kind: "error"; draft: Draft } & GenerationFailure);

export type ConsoleState = {
  status: Status;
  /** This session's generations, newest first. */
  generations: Generation[];
};

export type ConsoleAction =
  | { type: "start"; draft: Draft }
  | { type: "accepted"; seed: number; totalSteps: number }
  | { type: "progress"; step: number; totalSteps: number }
  | { type: "succeeded"; generation: Generation }
  | { type: "failed"; failure: GenerationFailure }
  | { type: "cancelled" }
  | { type: "select"; id: string }
  | { type: "reset" };

/** Generations are held in memory; cap them so a long session can't balloon. */
export const SESSION_LIMIT = 24;

export const initialConsoleState: ConsoleState = { status: { kind: "idle" }, generations: [] };

export function consoleReducer(state: ConsoleState, action: ConsoleAction): ConsoleState {
  const { status } = state;
  switch (action.type) {
    case "start":
      return {
        ...state,
        status: {
          kind: "generating",
          draft: action.draft,
          seed: action.draft.seed,
          step: 0,
          totalSteps: action.draft.steps,
        },
      };
    case "accepted":
      if (status.kind !== "generating") return state;
      return { ...state, status: { ...status, seed: action.seed, totalSteps: action.totalSteps } };
    case "progress":
      if (status.kind !== "generating") return state;
      return { ...state, status: { ...status, step: action.step, totalSteps: action.totalSteps } };
    case "succeeded":
      if (status.kind !== "generating") return state;
      return {
        status: { kind: "result", id: action.generation.id },
        generations: [action.generation, ...state.generations].slice(0, SESSION_LIMIT),
      };
    case "failed":
      if (status.kind !== "generating") return state;
      return { ...state, status: { kind: "error", draft: status.draft, ...action.failure } };
    case "cancelled":
      if (status.kind !== "generating") return state;
      return { ...state, status: latestOrIdle(state) };
    case "select":
      if (status.kind === "generating") return state;
      if (!state.generations.some((generation) => generation.id === action.id)) return state;
      return { ...state, status: { kind: "result", id: action.id } };
    case "reset":
      if (status.kind === "generating") return state;
      return { ...state, status: { kind: "idle" } };
  }
}

function latestOrIdle(state: ConsoleState): Status {
  const latest = state.generations[0];
  return latest ? { kind: "result", id: latest.id } : { kind: "idle" };
}

export function selectedGeneration(state: ConsoleState): Generation | null {
  if (state.status.kind !== "result") return null;
  const { id } = state.status;
  return state.generations.find((generation) => generation.id === id) ?? null;
}

/** Percent complete for the progress readout, 0-100. */
export function progressPercent(step: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.min(100, Math.round((step / totalSteps) * 100));
}
