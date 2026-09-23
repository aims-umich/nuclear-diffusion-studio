/**
 * The frozen `/api/generate` contract.
 *
 * This file is the single source of truth shared by the browser client, the
 * mock inference layer, and the proxy to the Python inference service. The
 * FastAPI backend (Track B) must implement exactly this shape - see
 * docs/API.md for the wire-level description.
 */
import { z } from "zod";

export const MODEL = {
  /** Hugging Face repo of the fine-tuned SDXL UNet. */
  id: "kumo24/sdxl_nuclear",
  /** Short display name used throughout the UI. */
  label: "nd-xl",
  precision: "fp16",
} as const;

export const LIMITS = {
  promptMaxLength: 500,
  negativePromptMaxLength: 500,
  steps: { min: 10, max: 50, default: 30 },
  guidance: { min: 1, max: 15, step: 0.5, default: 7.5 },
  sizes: [512, 768, 1024] as const,
  defaultSize: 1024,
  /** Seeds are unsigned 32-bit integers. */
  seedMax: 4_294_967_295,
} as const;

export type ImageSize = (typeof LIMITS.sizes)[number];

const sizeSchema = z.union(
  LIMITS.sizes.map((size) => z.literal(size)),
  { error: `Size must be one of ${LIMITS.sizes.join(", ")}` },
);

export const GenerateRequestSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1, "Prompt is required")
      .max(LIMITS.promptMaxLength),
    negative_prompt: z
      .string()
      .trim()
      .max(LIMITS.negativePromptMaxLength)
      .optional(),
    num_inference_steps: z
      .int()
      .min(LIMITS.steps.min)
      .max(LIMITS.steps.max)
      .default(LIMITS.steps.default),
    guidance_scale: z
      .number()
      .min(LIMITS.guidance.min)
      .max(LIMITS.guidance.max)
      .default(LIMITS.guidance.default),
    width: sizeSchema.default(LIMITS.defaultSize),
    height: sizeSchema.default(LIMITS.defaultSize),
    /** Omit for a random seed; the seed actually used is always returned. */
    seed: z.int().min(0).max(LIMITS.seedMax).optional(),
  })
  .strict();

/** What callers send (defaults may be omitted). */
export type GenerateRequestInput = z.input<typeof GenerateRequestSchema>;
/** What the server works with after validation and defaults. */
export type GenerateRequest = z.output<typeof GenerateRequestSchema>;

export const AppliedParamsSchema = z.object({
  prompt: z.string(),
  negative_prompt: z.string().optional(),
  num_inference_steps: z.int(),
  guidance_scale: z.number(),
  width: z.int(),
  height: z.int(),
  /** Diffusers scheduler actually used, e.g. "euler_a". */
  scheduler: z.string(),
});
export type AppliedParams = z.infer<typeof AppliedParamsSchema>;

/**
 * A successful response is `application/x-ndjson`: one JSON event per line,
 * `accepted` first, zero or more `progress`, then exactly one terminal
 * `result` or `error`.
 */
export const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("accepted"),
    seed: z.int(),
    total_steps: z.int(),
    model: z.string(),
  }),
  z.object({
    type: z.literal("progress"),
    step: z.int(),
    total_steps: z.int(),
  }),
  z.object({
    type: z.literal("result"),
    /** `data:` URL (PNG from the real model, SVG from the mock) or an https URL. */
    image: z.string(),
    seed: z.int(),
    params: AppliedParamsSchema,
    timing_ms: z.number(),
    model: z.string(),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type ResultEvent = Extract<StreamEvent, { type: "result" }>;

export const ERROR_CODES = {
  invalidRequest: "ERR_INVALID_REQUEST",
  coldStart: "ERR_COLD_START",
  rateLimited: "ERR_RATE_LIMITED",
  inference: "ERR_INFERENCE",
  upstream: "ERR_UPSTREAM",
  timeout: "ERR_TIMEOUT",
  /** Client-side only: the stream ended before a terminal event. */
  interrupted: "ERR_STREAM_INTERRUPTED",
  /** Client-side only: the browser could not reach /api/generate. */
  network: "ERR_NETWORK",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Body of every non-2xx response. */
export const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retry_after_s: z.number().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const NDJSON_CONTENT_TYPE = "application/x-ndjson";

/** Header used to force a mock scenario (ignored when proxying). */
export const MOCK_SCENARIO_HEADER = "x-nd-mock-scenario";
export const MOCK_SCENARIOS = ["ok", "cold-start", "inference-error", "slow"] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];
