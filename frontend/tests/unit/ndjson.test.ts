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

  it("throws on malformed JSON", async () => {
    await expect(collect(streamOf(["{nope}\n"]))).rejects.toThrow(SyntaxError);
  });
});
