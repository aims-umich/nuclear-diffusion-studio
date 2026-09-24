"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { generate, GenerateError } from "@/lib/api";
import { ERROR_CODES } from "@/lib/contract";
import { ThreadStore } from "@/lib/storage";
import {
  initialStudioState,
  persistableThreads,
  requestToInput,
  studioReducer,
  type GenerationFailure,
  type StudioState,
  type Thread,
  type TurnRequest,
} from "@/lib/studio-state";

const THREAD_PARAM = "thread";

/** `?mock=cold-start` etc. forces a mock scenario - handy for QA and design review. */
function mockScenarioFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("mock");
}

function toFailure(error: unknown): GenerationFailure {
  if (error instanceof GenerateError) {
    return { code: error.code, message: error.message, status: error.status, retryAfterSeconds: error.retryAfterSeconds };
  }
  return { code: ERROR_CODES.network, message: "Something went wrong. Try again.", status: null, retryAfterSeconds: null };
}

/** Mirror the open thread into `?thread=`, so a reload returns to it. Other params (like `?mock=`) are kept. */
function syncThreadParam(threadId: string | null) {
  const url = new URL(window.location.href);
  if (url.searchParams.get(THREAD_PARAM) === threadId) return;
  if (threadId) url.searchParams.set(THREAD_PARAM, threadId);
  else url.searchParams.delete(THREAD_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

export function useStudio() {
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);
  const controllerRef = useRef<AbortController | null>(null);
  const storeRef = useRef<ThreadStore | null>(null);
  const stateRef = useRef<StudioState>(state);

  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    const store = new ThreadStore();
    storeRef.current = store;
    const requested = new URLSearchParams(window.location.search).get(THREAD_PARAM);
    void store.load().then((threads) => dispatch({ type: "hydrate", threads, activeThreadId: requested }));
    return () => controllerRef.current?.abort();
  }, []);

  // Save on meaningful changes only; `revision` does not move on per-step progress.
  useEffect(() => {
    if (!state.hydrated) return;
    void storeRef.current?.save(persistableThreads(stateRef.current.threads));
  }, [state.hydrated, state.revision]);

  useEffect(() => {
    if (state.hydrated) syncThreadParam(state.activeThreadId);
  }, [state.hydrated, state.activeThreadId]);

  const stream = useCallback(async (request: TurnRequest) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await generate(requestToInput(request), {
        signal: controller.signal,
        mockScenario: mockScenarioFromUrl(),
        onEvent: (event) => {
          if (event.type === "accepted") dispatch({ type: "accepted", seed: event.seed, totalSteps: event.total_steps });
          else if (event.type === "progress") dispatch({ type: "progress", step: event.step, totalSteps: event.total_steps });
        },
      });
      dispatch({ type: "succeeded", images: result.images, params: result.params, timingMs: result.timing_ms, now: Date.now() });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({ type: "failed", failure: toFailure(error), now: Date.now() });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  /** Start a generation in the open thread, or in a new thread when none is open. */
  const run = useCallback(
    (request: TurnRequest) => {
      const current = stateRef.current;
      if (current.running) return false;
      dispatch({
        type: "start",
        threadId: current.activeThreadId,
        newThreadId: crypto.randomUUID(),
        turnId: crypto.randomUUID(),
        now: Date.now(),
        request,
      });
      void stream(request);
      return true;
    },
    [stream],
  );

  const retry = useCallback(
    (turnId: string) => {
      const current = stateRef.current;
      if (current.running) return;
      const turn = current.threads.flatMap((thread) => thread.turns).find((candidate) => candidate.id === turnId);
      if (!turn || turn.status !== "error") return;
      dispatch({ type: "retry", turnId, now: Date.now() });
      void stream(turn.request);
    },
    [stream],
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "cancelled" });
  }, []);

  const select = useCallback((threadId: string) => dispatch({ type: "select", threadId }), []);
  const newThread = useCallback(() => dispatch({ type: "new-thread" }), []);
  const deleteThread = useCallback((threadId: string) => dispatch({ type: "delete-thread", threadId }), []);
  const restoreThread = useCallback((thread: Thread) => dispatch({ type: "restore-thread", thread }), []);

  return { state, run, retry, cancel, select, newThread, deleteThread, restoreThread };
}
