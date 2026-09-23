import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/generate/route";
import { readNdjson } from "@/lib/ndjson";

/**
 * Exercises the real route handler in both modes - the mock engine and the
 * proxy - since the whole point of the seam is that they look identical.
 */

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function events(response: Response) {
  const out: Record<string, unknown>[] = [];
  for await (const value of readNdjson(response.body!)) out.push(value as Record<string, unknown>);
  return out;
}

const upstreamResult = {
  image: "data:image/png;base64,AA==",
  seed: 11,
  params: { prompt: "dome", num_inference_steps: 10, guidance_scale: 7.5, width: 512, height: 512, scheduler: "euler" },
  timing_ms: 4000,
  model: "kumo24/sdxl_nuclear",
};

beforeEach(() => {
  vi.stubEnv("MOCK_COLD_START_RATE", "0");
  vi.stubEnv("MOCK_ERROR_RATE", "0");
  vi.stubEnv("MOCK_SPEED", "1000");
  vi.stubEnv("INFERENCE_API_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/generate (mock mode)", () => {
  it("streams a padded NDJSON response ending in a result", async () => {
    const response = await POST(post({ prompt: "dome", num_inference_steps: 10, width: 512, height: 512, seed: 3 }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const raw = await response.clone().text();
    expect(raw.indexOf("\n")).toBeGreaterThan(1024); // first line padded past WebKit's buffer

    const stream = await events(response);
    expect(stream[0]).toMatchObject({ type: "accepted", seed: 3, total_steps: 10 });
    expect(stream.at(-1)).toMatchObject({ type: "result", seed: 3 });
  });

  it("rejects invalid bodies with the error contract", async () => {
    const notJson = await POST(post("{"));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: { code: "ERR_INVALID_REQUEST" } });

    const invalid = await POST(post({ prompt: "" }));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.message).toContain("Prompt is required");
  });

  it("simulates a cold start when forced", async () => {
    const response = await POST(post({ prompt: "dome" }, { "x-nd-mock-scenario": "cold-start" }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("20");
    expect(await response.json()).toMatchObject({ error: { code: "ERR_COLD_START", retry_after_s: 20 } });
  });
});

describe("POST /api/generate (proxy mode)", () => {
  beforeEach(() => {
    vi.stubEnv("INFERENCE_API_URL", "https://gpu.example.test/");
    vi.stubEnv("INFERENCE_API_TOKEN", "secret-token");
  });

  it("forwards the validated request with auth and relays an NDJSON stream", async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        [
          { type: "accepted", seed: 11, total_steps: 10, model: "kumo24/sdxl_nuclear" },
          { type: "progress", step: 1, total_steps: 10 },
          { type: "result", ...upstreamResult },
        ]
          .map((line) => JSON.stringify(line))
          .join("\n"),
        { headers: { "content-type": "application/x-ndjson" } },
      ),
    );
    vi.stubGlobal("fetch", upstream);

    const response = await POST(post({ prompt: " dome ", width: 512, height: 512, num_inference_steps: 10 }));
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe("https://gpu.example.test/generate");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
    expect(JSON.parse(init?.body as string)).toMatchObject({ prompt: "dome", guidance_scale: 7.5 });

    expect((await events(response)).map((event) => event.type)).toEqual(["accepted", "progress", "result"]);
  });

  it("normalises a synchronous JSON response into the stream contract", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(upstreamResult)));
    const stream = await events(await POST(post({ prompt: "dome" })));
    expect(stream).toEqual([
      { type: "accepted", seed: 11, total_steps: 10, model: "kumo24/sdxl_nuclear" },
      { type: "result", ...upstreamResult },
    ]);
  });

  it("replaces a contract-violating upstream event with an error event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response('{"type":"progress","step":"one"}\n', { headers: { "content-type": "application/x-ndjson" } }),
      ),
    );
    const stream = await events(await POST(post({ prompt: "dome" })));
    expect(stream.at(-1)).toMatchObject({ type: "error", code: "ERR_UPSTREAM" });
  });

  it.each([
    [503, "ERR_COLD_START", 503],
    [429, "ERR_RATE_LIMITED", 429],
    [422, "ERR_INVALID_REQUEST", 400],
    [500, "ERR_UPSTREAM", 502],
  ])("maps upstream %i to %s", async (upstreamStatus, code, status) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: upstreamStatus })));
    const response = await POST(post({ prompt: "dome" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it("reports an unreachable upstream as 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")));
    const response = await POST(post({ prompt: "dome" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "ERR_UPSTREAM" } });
  });

  it("ignores the mock scenario header", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(upstreamResult)));
    const response = await POST(post({ prompt: "dome" }, { "x-nd-mock-scenario": "cold-start" }));
    expect(response.status).toBe(200);
  });
});
