import { describe, expect, it } from "vitest";
import { GenerateRequestSchema, LIMITS, StreamEventSchema } from "@/lib/contract";

describe("GenerateRequestSchema", () => {
  it("applies defaults and trims the prompt", () => {
    const parsed = GenerateRequestSchema.parse({ prompt: "  containment dome  " });
    expect(parsed).toEqual({
      prompt: "containment dome",
      num_inference_steps: LIMITS.steps.default,
      guidance_scale: LIMITS.guidance.default,
      width: 1024,
      height: 1024,
    });
  });

  it("accepts a fully specified request", () => {
    const request = {
      prompt: "fuel rod cross-section",
      negative_prompt: "blurry",
      num_inference_steps: 50,
      guidance_scale: 15,
      width: 512,
      height: 768,
      seed: LIMITS.seedMax,
    };
    expect(GenerateRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    ["blank prompt", { prompt: "   " }],
    ["prompt over the limit", { prompt: "x".repeat(LIMITS.promptMaxLength + 1) }],
    ["steps below range", { prompt: "x", num_inference_steps: 9 }],
    ["fractional steps", { prompt: "x", num_inference_steps: 20.5 }],
    ["guidance above range", { prompt: "x", guidance_scale: 15.5 }],
    ["unsupported size", { prompt: "x", width: 600 }],
    ["negative seed", { prompt: "x", seed: -1 }],
    ["seed above uint32", { prompt: "x", seed: LIMITS.seedMax + 1 }],
    ["unknown key", { prompt: "x", sampler: "ddim" }],
  ])("rejects %s", (_label, body) => {
    expect(GenerateRequestSchema.safeParse(body).success).toBe(false);
  });

  it("explains an unsupported size", () => {
    const result = GenerateRequestSchema.safeParse({ prompt: "x", width: 600 });
    expect(result.error?.issues[0]?.message).toBe("Size must be one of 512, 768, 1024");
  });
});

describe("StreamEventSchema", () => {
  it("parses each event type", () => {
    expect(StreamEventSchema.parse({ type: "accepted", seed: 1, total_steps: 30, model: "m" }).type).toBe("accepted");
    expect(StreamEventSchema.parse({ type: "progress", step: 3, total_steps: 30 }).type).toBe("progress");
    expect(StreamEventSchema.parse({ type: "error", code: "ERR_INFERENCE", message: "boom" }).type).toBe("error");
  });

  it("rejects unknown event types", () => {
    expect(StreamEventSchema.safeParse({ type: "heartbeat" }).success).toBe(false);
  });
});
