import { describe, expect, it, vi } from "vitest";
import { generate, GenerateError } from "@/lib/api";
import type { StreamEvent } from "@/lib/contract";

const RESULT: StreamEvent = {
  type: "result",
  images: [{ image: "data:image/png;base64,AA==", seed: 5 }],
  params: {
    prompt: "p",
    num_inference_steps: 2,
    guidance_scale: 5,
    width: 1024,
    height: 1024,
    num_images: 1,
    scheduler: "euler",
    prompt_truncated: false,
    negative_prompt_truncated: false,
  },
  timing_ms: 120,
  model: "kumo24/sdxl_nuclear",
};

function ndjson(lines: unknown[], init: ResponseInit = {}) {
  return new Response(lines.map((line) => JSON.stringify(line)).join("\n") + "\n", {
    status: 200,
    headers: { "content-type": "application/x-ndjson" },
    ...init,
  });
}

const fetchReturning = (response: Response) => vi.fn<typeof fetch>().mockResolvedValue(response);

describe("generate", () => {
  it("resolves with the result and reports every event", async () => {
    const events: string[] = [];
    const fetchImpl = fetchReturning(
      ndjson([
        { type: "accepted", seed: 5, total_steps: 2, num_images: 1, model: "m" },
        { type: "progress", step: 1, total_steps: 2 },
        { type: "progress", step: 2, total_steps: 2 },
        RESULT,
      ]),
    );
    const result = await generate({ prompt: "p" }, { fetchImpl, onEvent: (event) => events.push(event.type) });
    expect(result).toEqual(RESULT);
    expect(events).toEqual(["accepted", "progress", "progress", "result"]);
  });

  it("sends the mock scenario header only when asked", async () => {
    const fetchImpl = fetchReturning(ndjson([RESULT]));
    await generate({ prompt: "p" }, { fetchImpl, mockScenario: "slow" });
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers["x-nd-mock-scenario"]).toBe("slow");
  });

  it("maps a 503 error body to a cold-start error with its retry hint", async () => {
    const fetchImpl = fetchReturning(
      Response.json({ error: { code: "ERR_COLD_START", message: "warming", retry_after_s: 20 } }, { status: 503 }),
    );
    await expect(generate({ prompt: "p" }, { fetchImpl })).rejects.toMatchObject({
      code: "ERR_COLD_START",
      status: 503,
      retryAfterSeconds: 20,
    });
  });

  it("falls back sensibly when the error body is not JSON", async () => {
    const fetchImpl = fetchReturning(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(generate({ prompt: "p" }, { fetchImpl })).rejects.toMatchObject({ code: "ERR_UPSTREAM", status: 502 });
  });

  it("throws the code from an in-stream error event", async () => {
    const fetchImpl = fetchReturning(
      ndjson([{ type: "accepted", seed: 1, total_steps: 2, num_images: 1, model: "m" }, { type: "error", code: "ERR_INFERENCE", message: "oom" }]),
    );
    await expect(generate({ prompt: "p" }, { fetchImpl })).rejects.toMatchObject({ code: "ERR_INFERENCE", message: "oom" });
  });

  it("reports a stream that ends without a terminal event", async () => {
    const fetchImpl = fetchReturning(ndjson([{ type: "accepted", seed: 1, total_steps: 2, num_images: 1, model: "m" }]));
    await expect(generate({ prompt: "p" }, { fetchImpl })).rejects.toMatchObject({ code: "ERR_STREAM_INTERRUPTED" });
  });

  it("rejects events that violate the contract", async () => {
    const fetchImpl = fetchReturning(ndjson([{ type: "accepted", seed: "not-a-number" }]));
    await expect(generate({ prompt: "p" }, { fetchImpl })).rejects.toMatchObject({ code: "ERR_UPSTREAM" });
  });

  it("maps a failed fetch to a network error", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    const error = await generate({ prompt: "p" }, { fetchImpl }).catch((caught) => caught);
    expect(error).toBeInstanceOf(GenerateError);
    expect(error.code).toBe("ERR_NETWORK");
  });

  it("rethrows the abort instead of wrapping it", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new DOMException("aborted", "AbortError"));
    const error = await generate({ prompt: "p" }, { fetchImpl, signal: controller.signal }).catch((caught) => caught);
    expect(error).not.toBeInstanceOf(GenerateError);
  });
});
