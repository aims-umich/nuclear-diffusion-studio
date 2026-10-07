import { describe, expect, it, vi } from "vitest";
import { GenerateRequestSchema } from "@/lib/contract";
import { readNdjson } from "@/lib/ndjson";
import { proxyGenerate } from "@/lib/server/proxy";

const request = GenerateRequestSchema.parse({ prompt: "dome", num_inference_steps: 10 });

const result = {
  type: "result",
  images: [{ image: "data:image/png;base64,AA==", seed: 1 }],
  params: {
    prompt: "dome",
    num_inference_steps: 10,
    guidance_scale: 5,
    width: 1024,
    height: 1024,
    num_images: 1,
    scheduler: "euler",
    prompt_truncated: false,
    negative_prompt_truncated: false,
  },
  timing_ms: 100,
  model: "kumo24/sdxl_nuclear",
};

/** An upstream NDJSON body that emits one event every `gapMs` and, like real fetch, errors once `signal` aborts. */
function slowStream(events: object[], gapMs: number, signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      if (index === events.length) return controller.close();
      await new Promise((resolve) => setTimeout(resolve, index === 0 ? 0 : gapMs));
      if (signal.aborted) return controller.error(signal.reason);
      controller.enqueue(encoder.encode(JSON.stringify(events[index++]) + "\n"));
    },
  });
}

async function collect(response: Response) {
  const out: Record<string, unknown>[] = [];
  for await (const value of readNdjson(response.body!)) out.push(value as Record<string, unknown>);
  return out;
}

describe("proxyGenerate timeout", () => {
  it("bounds the wait for a response, not a stream that is already running", async () => {
    // A cold container plus a batch of four on a slow GPU can stream well past the response timeout.
    const events = [
      { type: "accepted", seed: 1, total_steps: 10, num_images: 1, model: "kumo24/sdxl_nuclear" },
      ...Array.from({ length: 10 }, (_, i) => ({ type: "progress", step: i + 1, total_steps: 10 })),
      result,
    ];
    const fetchImpl = vi.fn<typeof fetch>(
      async (_url, init) =>
        new Response(slowStream(events, 15, init!.signal!), { headers: { "content-type": "application/x-ndjson" } }),
    );

    const response = await proxyGenerate(request, {
      baseUrl: "https://gpu.example.test",
      timeoutMs: 60,
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect((await collect(response)).at(-1)).toMatchObject({ type: "result" });
  });

  it("answers 504 when the upstream sends no response in time", async () => {
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });

    const response = await proxyGenerate(request, {
      baseUrl: "https://gpu.example.test",
      timeoutMs: 20,
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: "ERR_TIMEOUT" } });
  });
});
