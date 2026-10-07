/**
 * The frozen `/api/generate` contract.
 *
 * This file is the single source of truth shared by the browser client, the
 * mock inference layer, and the proxy to the Python inference service. The
 * FastAPI backend (Track B) must implement exactly this shape - see
 * docs/API.md for the wire-level description.
 *
 * Every knob here is one the model actually supports. `kumo24/sdxl_nuclear` is
 * a fine-tuned SDXL UNet loaded into the stock SDXL base pipeline, so sizes,
 * the scheduler, and the prompt token limit all come from SDXL itself.
 */
import { z } from "zod";

export const MODEL = {
  /** Hugging Face repo of the fine-tuned SDXL UNet. */
  id: "kumo24/sdxl_nuclear",
  /** Short display name used throughout the UI. */
  label: "nd-xl",
  /** The pipeline the UNet is loaded into. */
  base: "stabilityai/stable-diffusion-xl-base-1.0",
  precision: "fp16",
  /** The SDXL base pipeline's default scheduler (EulerDiscreteScheduler). */
  scheduler: "euler",
  /**
   * SDXL's CLIP text encoders read 77 tokens, two of which are the start and
   * end markers. Anything past this is dropped by the pipeline.
   */
  maxPromptTokens: 75,
} as const;

/**
 * The output sizes offered, all SDXL-native (about one megapixel, sides
 * divisible by 64). SDXL degrades well below this pixel count, so smaller
 * sizes are deliberately absent. The fine-tune itself was trained only on
 * 1024x1024 images, which is why non-square presets are flagged `trained: false`.
 */
export const SIZE_PRESETS = [
  { id: "1:1", width: 1024, height: 1024, trained: true },
  { id: "4:3", width: 1152, height: 896, trained: false },
  { id: "3:4", width: 896, height: 1152, trained: false },
  { id: "3:2", width: 1216, height: 832, trained: false },
  { id: "2:3", width: 832, height: 1216, trained: false },
  { id: "16:9", width: 1344, height: 768, trained: false },
] as const;

export type SizePreset = (typeof SIZE_PRESETS)[number];
export type SizeId = SizePreset["id"];

export function findSizePreset(width: number, height: number): SizePreset | undefined {
  return SIZE_PRESETS.find((preset) => preset.width === width && preset.height === height);
}

export function sizePresetById(id: SizeId): SizePreset {
  return SIZE_PRESETS.find((preset) => preset.id === id) ?? SIZE_PRESETS[0];
}

/** Defaults follow the model card and the NuclearDiffusion paper (50 steps, guidance 5.0, no negative prompt). */
export const LIMITS = {
  promptMaxLength: 500,
  negativePromptMaxLength: 500,
  steps: { min: 10, max: 50, default: 50 },
  guidance: { min: 1, max: 15, step: 0.5, default: 5 },
  images: { min: 1, max: 4, default: 1 },
  /** Seeds are unsigned 32-bit integers. */
  seedMax: 4_294_967_295,
} as const;

export const DEFAULT_SIZE = SIZE_PRESETS[0];

/** Image `index` of a batch uses the base seed plus its index, wrapping within uint32. */
export function seedForImage(baseSeed: number, index: number): number {
  return (baseSeed + index) >>> 0;
}

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
    width: z.int().default(DEFAULT_SIZE.width),
    height: z.int().default(DEFAULT_SIZE.height),
    /** Images generated in one batch; image i uses seed + i. */
    num_images: z
      .int()
      .min(LIMITS.images.min)
      .max(LIMITS.images.max)
      .default(LIMITS.images.default),
    /** Omit for a random seed; the seed actually used is always returned. */
    seed: z.int().min(0).max(LIMITS.seedMax).optional(),
  })
  .strict()
  .refine((request) => findSizePreset(request.width, request.height) !== undefined, {
    message: `Size must be one of ${SIZE_PRESETS.map((preset) => `${preset.width}x${preset.height}`).join(", ")}`,
    path: ["width"],
  });

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
  num_images: z.int(),
  /** Diffusers scheduler actually used, e.g. "euler". */
  scheduler: z.string(),
  /** True when the prompt ran past the text encoders' token limit and its tail was ignored. */
  prompt_truncated: z.boolean().default(false),
  /** The same, for the negative prompt. */
  negative_prompt_truncated: z.boolean().default(false),
});
export type AppliedParams = z.infer<typeof AppliedParamsSchema>;

export const GeneratedImageSchema = z.object({
  /** `data:` URL (PNG from the real model, SVG from the mock) or an https URL. */
  image: z.string(),
  seed: z.int(),
});
export type GeneratedImage = z.infer<typeof GeneratedImageSchema>;

/**
 * A successful response is `application/x-ndjson`: one JSON event per line,
 * `accepted` first, zero or more `progress`, then exactly one terminal
 * `result` or `error`.
 */
export const StreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("accepted"),
    /** The base seed; image i of the batch uses seed + i. */
    seed: z.int(),
    total_steps: z.int(),
    num_images: z.int(),
    model: z.string(),
  }),
  z.object({
    type: z.literal("progress"),
    step: z.int(),
    total_steps: z.int(),
  }),
  z.object({
    type: z.literal("result"),
    /** One entry per generated image, in batch order. */
    images: z.array(GeneratedImageSchema).min(1),
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
/**
 * `waking` holds back `accepted` the way a serverless GPU host (Modal) holds a
 * request while a container starts from zero; `cold-start` is the 503 a host
 * that refuses the request instead would send.
 */
export const MOCK_SCENARIOS = ["ok", "cold-start", "waking", "inference-error", "slow"] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];
