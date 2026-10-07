import { describe, expect, it } from "vitest";
import { readNdjson } from "@/lib/ndjson";

function streamOf(chunks: (string | Uint8Array)[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const values: unknown[] = [];
  for await (const value of readNdjson(stream)) values.push(value);
  return values;
}

describe("readNdjson", () => {
  it("reassembles lines split across chunks", async () => {
    expect(await collect(streamOf(['{"a":', "1}\n{", '"b":2}\n']))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("parses a final line without a trailing newline", async () => {
    expect(await collect(streamOf(['{"a":1}\n{"b":2}']))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("tolerates whitespace padding and blank lines", async () => {
    expect(await collect(streamOf([`{"a":1}${" ".repeat(1024)}\n\n  \n{"b":2}\n`]))).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("decodes multi-byte characters split across chunk boundaries", async () => {
    const bytes = new TextEncoder().encode('{"prompt":"1024²"}\n');
    const cut = bytes.indexOf(0xc2) + 1; // split inside the two-byte "²"
    expect(await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]))).toEqual([{ prompt: "1024²" }]);
  });

  it("reads a multi-megabyte line arriving in small chunks in linear time", async () => {
    // A batch of four real images is one ~8 MB result line; network chunks are often a few KB.
    const image = "data:image/png;base64," + "A".repeat(2_000_000);
    const text = JSON.stringify({ images: [image, image, image, image] }) + '\n{"next":true}\n';
    const chunks = Array.from({ length: Math.ceil(text.length / 2048) }, (_, i) => text.slice(i * 2048, (i + 1) * 2048));

    const started = performance.now();
    const values = await collect(streamOf(chunks));

    expect(values).toEqual([{ images: [image, image, image, image] }, { next: true }]);
    // Rescanning the whole buffer per chunk took ~7s here; linear reading takes well under 100ms.
    expect(performance.now() - started).toBeLessThan(1500);
  });

  it("throws on malformed JSON", async () => {
    await expect(collect(streamOf(["{nope}\n"]))).rejects.toThrow(SyntaxError);
  });
});
