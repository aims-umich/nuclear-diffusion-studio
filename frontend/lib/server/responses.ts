import "server-only";

import { ERROR_CODES, NDJSON_CONTENT_TYPE, type ErrorBody, type StreamEvent } from "@/lib/contract";

/**
 * WebKit buffers streamed responses until ~1 KiB has arrived, which would
 * swallow the first several progress events. Padding the first line with JSON
 * whitespace (still valid JSON) pushes it past that threshold.
 */
const FIRST_LINE_PADDING = " ".repeat(1024);

export function errorResponse(
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
): Response {
  const body: ErrorBody = {
    error: { code, message, ...(retryAfterSeconds ? { retry_after_s: retryAfterSeconds } : {}) },
  };
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : {}),
    },
  });
}

export function ndjsonResponse(events: AsyncIterable<StreamEvent>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const iterator = events[Symbol.asyncIterator]();
  let first = true;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }
        const line = JSON.stringify(value) + (first ? FIRST_LINE_PADDING : "") + "\n";
        first = false;
        controller.enqueue(encoder.encode(line));
      } catch (error) {
        if (signal.aborted) {
          // The client went away; there is nobody left to tell.
          controller.close();
          return;
        }
        console.error("[generate] stream failed", error);
        const event: StreamEvent = {
          type: "error",
          code: ERROR_CODES.inference,
          message: "Generation failed unexpectedly. Try again.",
        };
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": `${NDJSON_CONTENT_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
