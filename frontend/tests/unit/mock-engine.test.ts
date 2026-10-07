import { describe, expect, it } from "vitest";
import { GenerateRequestSchema, type StreamEvent } from "@/lib/contract";
import {
  WAKING_DELAY_MS,
  mockConfigFromEnv,
  parseScenario,
  pickScenario,
  runMockGeneration,
  type MockConfig,
} from "@/lib/mock/engine";
import { renderMockImage } from "@/lib/mock/render";

const FAST: MockConfig = { coldStartRate: 0, errorRate: 0, speed: 1000 };

async function collect(events: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const request = (overrides: Record<string, unknown> = {}) =>
  GenerateRequestSchema.parse({ prompt: "Containment dome at dusk", num_inference_steps: 10, ...overrides });

describe("runMockGeneration", () => {
  it("emits accepted, one progress event per step, then a result", async () => {
    const events = await collect(runMockGeneration(request({ seed: 7 }), "ok", FAST));
    expect(events.map((event) => event.type)).toEqual(["accepted", ...Array(10).fill("progress"), "result"]);
    expect(events[0]).toMatchObject({ type: "accepted", seed: 7, total_steps: 10, num_images: 1 });
    expect(events.filter((event) => event.type === "progress").map((event) => event.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = events.at(-1);
    expect(result).toMatchObject({
      type: "result",
      images: [{ seed: 7 }],
      params: {
        prompt: "Containment dome at dusk",
        num_inference_steps: 10,
        width: 1024,
        height: 1024,
        num_images: 1,
        scheduler: "euler",
        prompt_truncated: false,
        negative_prompt_truncated: false,
      },
    });
    if (result?.type !== "result") throw new Error("expected a result");
    expect(result.images[0].image.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(result.timing_ms).toBeGreaterThanOrEqual(0);
  });

  it("returns one image per requested image, seeded seed + index", async () => {
    const events = await collect(runMockGeneration(request({ seed: 4_294_967_294, num_images: 3, width: 1216, height: 832 }), "ok", FAST));
    const result = events.at(-1);
    if (result?.type !== "result") throw new Error("expected a result");
    expect(result.images.map((image) => image.seed)).toEqual([4_294_967_294, 4_294_967_295, 0]);
    expect(new Set(result.images.map((image) => image.image)).size).toBe(3);
    expect(result.params).toMatchObject({ width: 1216, height: 832, num_images: 3 });
  });

  it("reports a prompt that runs past the token window", async () => {
    const long = "Cutaway of a pressurized-water reactor core, fuel assemblies and control rods, ".repeat(6);
    const result = (await collect(runMockGeneration(request({ prompt: long.slice(0, 500) }), "ok", FAST))).at(-1);
    expect(result).toMatchObject({ type: "result", params: { prompt_truncated: true } });
  });

  it("picks a random seed when none is given and reports it", async () => {
    const [accepted] = await collect(runMockGeneration(request(), "ok", FAST));
    expect(accepted.type === "accepted" && Number.isInteger(accepted.seed)).toBe(true);
  });

  it("fails mid-denoise in the inference-error scenario", async () => {
    const events = await collect(runMockGeneration(request(), "inference-error", FAST));
    expect(events.at(-1)).toMatchObject({ type: "error", code: "ERR_INFERENCE" });
    expect(events.filter((event) => event.type === "progress")).toHaveLength(3);
  });

  it("holds back accepted while the GPU wakes, then runs normally", async () => {
    const speed = 100;
    const started = performance.now();
    const events = runMockGeneration(request({ seed: 7 }), "waking", { ...FAST, speed })[Symbol.asyncIterator]();

    const accepted = await events.next();
    expect(performance.now() - started).toBeGreaterThanOrEqual(WAKING_DELAY_MS / speed - 5);
    expect(accepted.value).toMatchObject({ type: "accepted", seed: 7 });
    const rest = [];
    for (let next = await events.next(); !next.done; next = await events.next()) rest.push(next.value.type);
    expect(rest).toEqual([...Array(10).fill("progress"), "result"]);
  });

  it("stops when the request is aborted", async () => {
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    const run = (async () => {
      for await (const event of runMockGeneration(request(), "ok", { ...FAST, speed: 1 }, controller.signal)) {
        events.push(event);
        if (event.type === "progress" && event.step === 2) controller.abort();
      }
    })();
    await expect(run).rejects.toBeDefined();
    expect(events.some((event) => event.type === "result")).toBe(false);
  });
});

describe("renderMockImage", () => {
  const square = { width: 1024, height: 1024 };

  it("is deterministic in seed and prompt", () => {
    const a = renderMockImage({ seed: 42, prompt: "PWR core", ...square });
    expect(renderMockImage({ seed: 42, prompt: "PWR core", ...square })).toBe(a);
    expect(renderMockImage({ seed: 43, prompt: "PWR core", ...square })).not.toBe(a);
    expect(renderMockImage({ seed: 42, prompt: "graphite lattice", ...square })).not.toBe(a);
  });

  it("labels itself as mock output at the requested size", () => {
    const svg = renderMockImage({ seed: 1, prompt: "x", ...square });
    expect(svg).toContain('width="1024" height="1024" viewBox="0.0 0.0 1024.0 1024.0"');
    expect(svg).toContain("MOCK OUTPUT");
  });

  it("widens the view around the core for landscape sizes", () => {
    const svg = renderMockImage({ seed: 1, prompt: "x", width: 1344, height: 768 });
    expect(svg).toContain('width="1344" height="768" viewBox="-384.0 0.0 1792.0 1024.0"');
  });
});

describe("scenario selection", () => {
  it("honours a forced scenario", () => {
    expect(pickScenario("slow", { coldStartRate: 1, errorRate: 1, speed: 1 })).toBe("slow");
  });

  it("rolls configured rates", () => {
    const config = { coldStartRate: 0.1, errorRate: 0.1, speed: 1 };
    expect(pickScenario(null, config, () => 0.05)).toBe("cold-start");
    const rolls = [0.5, 0.05];
    expect(pickScenario(null, config, () => rolls.shift()!)).toBe("inference-error");
    expect(pickScenario(null, config, () => 0.9)).toBe("ok");
  });

  it("parses only known scenario names", () => {
    expect(parseScenario("cold-start")).toBe("cold-start");
    expect(parseScenario("waking")).toBe("waking");
    expect(parseScenario("meltdown")).toBeNull();
    expect(parseScenario(null)).toBeNull();
  });

  it("reads and clamps config from the environment", () => {
    expect(mockConfigFromEnv({})).toEqual({ coldStartRate: 0.05, errorRate: 0.02, speed: 1 });
    expect(mockConfigFromEnv({ MOCK_COLD_START_RATE: "2", MOCK_ERROR_RATE: "-1", MOCK_SPEED: "0" })).toEqual({
      coldStartRate: 1,
      errorRate: 0,
      speed: 1,
    });
    expect(mockConfigFromEnv({ MOCK_COLD_START_RATE: "0", MOCK_SPEED: "4" })).toMatchObject({ coldStartRate: 0, speed: 4 });
  });
});
