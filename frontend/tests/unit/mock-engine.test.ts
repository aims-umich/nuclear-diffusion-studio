import { describe, expect, it } from "vitest";
import { GenerateRequestSchema, type StreamEvent } from "@/lib/contract";
import { mockConfigFromEnv, parseScenario, pickScenario, runMockGeneration, type MockConfig } from "@/lib/mock/engine";
import { renderMockImage } from "@/lib/mock/render";

const FAST: MockConfig = { coldStartRate: 0, errorRate: 0, speed: 1000 };

async function collect(events: AsyncIterable<StreamEvent>) {
  const out: StreamEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const request = (overrides: Record<string, unknown> = {}) =>
  GenerateRequestSchema.parse({ prompt: "Containment dome at dusk", num_inference_steps: 10, width: 512, height: 512, ...overrides });

describe("runMockGeneration", () => {
  it("emits accepted, one progress event per step, then a result", async () => {
    const events = await collect(runMockGeneration(request({ seed: 7 }), "ok", FAST));
    expect(events.map((event) => event.type)).toEqual(["accepted", ...Array(10).fill("progress"), "result"]);
    expect(events[0]).toMatchObject({ type: "accepted", seed: 7, total_steps: 10 });
    expect(events.filter((event) => event.type === "progress").map((event) => event.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const result = events.at(-1);
    expect(result).toMatchObject({
      type: "result",
      seed: 7,
      params: { prompt: "Containment dome at dusk", num_inference_steps: 10, width: 512, height: 512, scheduler: "euler_a" },
    });
    if (result?.type !== "result") throw new Error("expected a result");
    expect(result.image.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(result.timing_ms).toBeGreaterThanOrEqual(0);
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
  it("is deterministic in seed and prompt", () => {
    const a = renderMockImage({ seed: 42, prompt: "PWR core", size: 1024 });
    expect(renderMockImage({ seed: 42, prompt: "PWR core", size: 1024 })).toBe(a);
    expect(renderMockImage({ seed: 43, prompt: "PWR core", size: 1024 })).not.toBe(a);
    expect(renderMockImage({ seed: 42, prompt: "graphite lattice", size: 1024 })).not.toBe(a);
  });

  it("labels itself as mock output at the requested size", () => {
    const svg = renderMockImage({ seed: 1, prompt: "x", size: 768 });
    expect(svg).toContain('width="768" height="768"');
    expect(svg).toContain("MOCK OUTPUT");
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
