import "server-only";

import {
  ERROR_CODES,
  MODEL,
  MOCK_SCENARIOS,
  type GenerateRequest,
  type MockScenario,
  type StreamEvent,
} from "@/lib/contract";
import { createRng, randomSeed } from "@/lib/prng";
import { renderMockImage, svgToDataUrl } from "@/lib/mock/render";

/**
 * Mock inference engine used while the real GPU backend does not exist.
 *
 * It honours the full contract - validated params in, an `accepted` event,
 * per-step `progress`, then a `result` - with latency modelled on SDXL on an
 * A10G, so every UI state is exercised without a backend.
 */

/** Approximate per-step latency on a warm A10G, by output size. */
const STEP_MS: Record<number, number> = { 512: 38, 768: 68, 1024: 104 };
const SCHEDULER = "euler_a";

export type MockConfig = {
  /** Probability [0, 1] that a request hits a simulated cold start. */
  coldStartRate: number;
  /** Probability [0, 1] that a request fails mid-denoise. */
  errorRate: number;
  /** Multiplier on step latency (1 = realistic). */
  speed: number;
};

export function mockConfigFromEnv(env: Record<string, string | undefined> = process.env): MockConfig {
  return {
    coldStartRate: clampRate(env.MOCK_COLD_START_RATE, 0.05),
    errorRate: clampRate(env.MOCK_ERROR_RATE, 0.02),
    speed: clampPositive(env.MOCK_SPEED, 1),
  };
}

export function parseScenario(value: string | null): MockScenario | null {
  return MOCK_SCENARIOS.find((scenario) => scenario === value) ?? null;
}

/** Resolve the scenario for one request: a forced scenario wins, otherwise roll the configured rates. */
export function pickScenario(
  forced: MockScenario | null,
  config: MockConfig,
  roll: () => number = Math.random,
): MockScenario {
  if (forced) return forced;
  if (roll() < config.coldStartRate) return "cold-start";
  if (roll() < config.errorRate) return "inference-error";
  return "ok";
}

export const COLD_START_RETRY_AFTER_S = 20;

export async function* runMockGeneration(
  request: GenerateRequest,
  scenario: Exclude<MockScenario, "cold-start">,
  config: MockConfig,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent> {
  const started = performance.now();
  const seed = request.seed ?? randomSeed();
  const total = request.num_inference_steps;
  const jitter = createRng(seed);
  const baseStepMs = (STEP_MS[request.width] ?? STEP_MS[1024]) * (scenario === "slow" ? 6 : 1);
  const failAt = scenario === "inference-error" ? Math.max(1, Math.floor(total * 0.4)) : -1;

  yield { type: "accepted", seed, total_steps: total, model: MODEL.id };

  for (let step = 1; step <= total; step++) {
    await sleep((baseStepMs * (0.85 + jitter() * 0.3)) / config.speed, signal);
    if (step === failAt) {
      yield {
        type: "error",
        code: ERROR_CODES.inference,
        message: "The denoising loop failed on the GPU. Try again, or pick a different seed.",
      };
      return;
    }
    yield { type: "progress", step, total_steps: total };
  }

  const svg = renderMockImage({ seed, prompt: request.prompt, size: request.width });
  yield {
    type: "result",
    image: svgToDataUrl(svg),
    seed,
    params: {
      prompt: request.prompt,
      ...(request.negative_prompt ? { negative_prompt: request.negative_prompt } : {}),
      num_inference_steps: total,
      guidance_scale: request.guidance_scale,
      width: request.width,
      height: request.height,
      scheduler: SCHEDULER,
    },
    timing_ms: Math.round(performance.now() - started),
    model: MODEL.id,
  };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function clampRate(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (value === undefined || value === "" || Number.isNaN(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function clampPositive(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (value === undefined || value === "" || !(parsed > 0)) return fallback;
  return parsed;
}
