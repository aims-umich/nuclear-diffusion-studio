"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { generate, GenerateError } from "@/lib/api";
import { ERROR_CODES, type GenerateRequestInput } from "@/lib/contract";
import {
  consoleReducer,
  initialConsoleState,
  type Draft,
  type GenerationFailure,
} from "@/lib/console-state";

export function draftToRequest(draft: Draft): GenerateRequestInput {
  return {
    prompt: draft.prompt,
    num_inference_steps: draft.steps,
    guidance_scale: draft.guidance,
    width: draft.size,
    height: draft.size,
    ...(draft.seed === null ? {} : { seed: draft.seed }),
  };
}

/** `?mock=cold-start` etc. forces a mock scenario - handy for QA and design review. */
function mockScenarioFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("mock");
}

function toFailure(error: unknown): GenerationFailure {
  if (error instanceof GenerateError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }
  return {
    code: ERROR_CODES.network,
    message: "Something went wrong. Try again.",
    status: null,
    retryAfterSeconds: null,
  };
}

export function useGenerator() {
  const [state, dispatch] = useReducer(consoleReducer, initialConsoleState);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async (draft: Draft) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    dispatch({ type: "start", draft });

    try {
      const result = await generate(draftToRequest(draft), {
        signal: controller.signal,
        mockScenario: mockScenarioFromUrl(),
        onEvent: (event) => {
          if (event.type === "accepted") {
            dispatch({ type: "accepted", seed: event.seed, totalSteps: event.total_steps });
          } else if (event.type === "progress") {
            dispatch({ type: "progress", step: event.step, totalSteps: event.total_steps });
          }
        },
      });
      dispatch({
        type: "succeeded",
        generation: {
          id: crypto.randomUUID(),
          image: result.images[0].image,
          seed: result.images[0].seed,
          params: result.params,
          timingMs: result.timing_ms,
          model: result.model,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      dispatch({ type: "failed", failure: toFailure(error) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "cancelled" });
  }, []);

  const select = useCallback((id: string) => dispatch({ type: "select", id }), []);
  const reset = useCallback(() => dispatch({ type: "reset" }), []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return { state, run, cancel, select, reset };
}
