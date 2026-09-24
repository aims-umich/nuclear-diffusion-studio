import { describe, expect, it } from "vitest";
import {
  GenerateRequestSchema,
  LIMITS,
  SIZE_PRESETS,
  StreamEventSchema,
  findSizePreset,
  seedForImage,
} from "@/lib/contract";

describe("GenerateRequestSchema", () => {
  it("applies the model-card defaults and trims the prompt", () => {
    const parsed = GenerateRequestSchema.parse({ prompt: "  containment dome  " });
    expect(parsed).toEqual({
      prompt: "containment dome",
      num_inference_steps: 50,
      guidance_scale: 5,
      width: 1024,
      height: 1024,
      num_images: 1,
    });
  });

  it("accepts a fully specified request", () => {
    const request = {
      prompt: "fuel rod cross-section",
      negative_prompt: "blurry",
      num_inference_steps: 10,
      guidance_scale: 15,
      width: 1216,
      height: 832,
      num_images: 4,
      seed: LIMITS.seedMax,
    };
    expect(GenerateRequestSchema.parse(request)).toEqual(request);
  });

  it.each(SIZE_PRESETS.map((preset) => [preset.id, preset.width, preset.height]))(
    "accepts the %s preset",
    (_id, width, height) => {
      expect(GenerateRequestSchema.safeParse({ prompt: "x", width, height }).success).toBe(true);
    },
  );

  it.each([
    ["blank prompt", { prompt: "   " }],
    ["prompt over the limit", { prompt: "x".repeat(LIMITS.promptMaxLength + 1) }],
    ["steps below range", { prompt: "x", num_inference_steps: 9 }],
    ["fractional steps", { prompt: "x", num_inference_steps: 20.5 }],
    ["guidance above range", { prompt: "x", guidance_scale: 15.5 }],
    ["a sub-megapixel size SDXL renders poorly", { prompt: "x", width: 512, height: 512 }],
    ["a preset width with the wrong height", { prompt: "x", width: 1216, height: 1024 }],
    ["zero images", { prompt: "x", num_images: 0 }],
    ["too many images", { prompt: "x", num_images: 5 }],
    ["negative seed", { prompt: "x", seed: -1 }],
    ["seed above uint32", { prompt: "x", seed: LIMITS.seedMax + 1 }],
    ["unknown key", { prompt: "x", sampler: "ddim" }],
  ])("rejects %s", (_label, body) => {
    expect(GenerateRequestSchema.safeParse(body).success).toBe(false);
  });

  it("explains an unsupported size", () => {
    const result = GenerateRequestSchema.safeParse({ prompt: "x", width: 512, height: 512 });
    expect(result.error?.issues[0]?.message).toBe(
      "Size must be one of 1024x1024, 1152x896, 896x1152, 1216x832, 832x1216, 1344x768",
    );
  });
});

describe("size presets", () => {
  it("are all SDXL-native: about one megapixel with sides divisible by 64", () => {
    for (const preset of SIZE_PRESETS) {
      expect(preset.width % 64).toBe(0);
      expect(preset.height % 64).toBe(0);
      expect(preset.width * preset.height).toBeGreaterThan(0.95 * 1024 * 1024);
      expect(preset.width * preset.height).toBeLessThan(1.05 * 1024 * 1024);
    }
  });

  it("marks only the square size as trained", () => {
    expect(SIZE_PRESETS.filter((preset) => preset.trained).map((preset) => preset.id)).toEqual(["1:1"]);
    expect(findSizePreset(1344, 768)?.id).toBe("16:9");
    expect(findSizePreset(512, 512)).toBeUndefined();
  });
});

describe("seedForImage", () => {
  it("offsets the base seed by the image index and wraps within uint32", () => {
    expect(seedForImage(10, 0)).toBe(10);
    expect(seedForImage(10, 3)).toBe(13);
    expect(seedForImage(LIMITS.seedMax, 1)).toBe(0);
  });
});

describe("StreamEventSchema", () => {
  it("parses each event type", () => {
    expect(StreamEventSchema.parse({ type: "accepted", seed: 1, total_steps: 30, num_images: 2, model: "m" }).type).toBe("accepted");
    expect(StreamEventSchema.parse({ type: "progress", step: 3, total_steps: 30 }).type).toBe("progress");
    expect(StreamEventSchema.parse({ type: "error", code: "ERR_INFERENCE", message: "boom" }).type).toBe("error");
  });

  it("defaults the truncation flags when a backend omits them", () => {
    const result = StreamEventSchema.parse({
      type: "result",
      images: [{ image: "data:image/png;base64,AA==", seed: 1 }],
      params: { prompt: "p", num_inference_steps: 50, guidance_scale: 5, width: 1024, height: 1024, num_images: 1, scheduler: "euler" },
      timing_ms: 1,
      model: "m",
    });
    expect(result.type === "result" && result.params.prompt_truncated).toBe(false);
  });

  it("rejects a result without images", () => {
    expect(
      StreamEventSchema.safeParse({
        type: "result",
        images: [],
        params: { prompt: "p", num_inference_steps: 50, guidance_scale: 5, width: 1024, height: 1024, num_images: 1, scheduler: "euler" },
        timing_ms: 1,
        model: "m",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown event types", () => {
    expect(StreamEventSchema.safeParse({ type: "heartbeat" }).success).toBe(false);
  });
});
