/**
 * Parse a newline-delimited JSON byte stream into values, one per line.
 * Works in both the browser and the Node runtime (Web Streams only).
 *
 * A `result` line carries every image as base64 and can be several megabytes,
 * arriving in many small chunks. Only each new chunk is searched for a newline
 * and a line's pieces are joined once, so reading stays linear in its size.
 */
export async function* readNdjson(stream: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  // The pieces of the line still being received.
  let pending: string[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      let text = decoder.decode(value, { stream: true });
      let newline = text.indexOf("\n");
      while (newline !== -1) {
        pending.push(text.slice(0, newline));
        const line = pending.join("").trim();
        pending = [];
        if (line) yield JSON.parse(line);
        text = text.slice(newline + 1);
        newline = text.indexOf("\n");
      }
      if (text) pending.push(text);
    }
    const rest = (pending.join("") + decoder.decode()).trim();
    if (rest) yield JSON.parse(rest);
  } finally {
    reader.releaseLock();
  }
}
