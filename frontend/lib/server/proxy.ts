import "server-only";

import { z } from "zod";
import {
  AppliedParamsSchema,
  ERROR_CODES,
  GeneratedImageSchema,
  ErrorBodySchema,
  MODEL,
  NDJSON_CONTENT_TYPE,
  StreamEventSchema,
  type GenerateRequest,
  type StreamEvent,
} from "@/lib/contract";
import { readNdjson } from "@/lib/ndjson";
import { errorResponse, ndjsonResponse } from "@/lib/server/responses";

/**
 * Proxy to the Python inference service (Track B).
 *
 * Active when INFERENCE_API_URL is set. The upstream may either stream the
 * NDJSON contract directly, or answer with a single synchronous JSON body
 * (the simpler shape from the original plan); both are normalised into the
 * same NDJSON stream so the browser never knows the difference.
 */

export type ProxyOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
};

/** The synchronous response shape a simpler backend may return. */
const SyncResultSchema = z.object({
  images: z.array(GeneratedImageSchema).min(1),
  params: AppliedParamsSchema.extend({ scheduler: z.string().default("unknown") }),
  timing_ms: z.number(),
  model: z.string().default(MODEL.id),
});

export async function proxyGenerate(request: GenerateRequest, options: ProxyOptions): Promise<Response> {
  const { baseUrl, token, timeoutMs, signal, fetchImpl = fetch } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);

  let upstream: Response;
  try {
    upstream = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: `${NDJSON_CONTENT_TYPE}, application/json`,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
      signal: combined,
      cache: "no-store",
    });
  } catch (error) {
    if (timeout.aborted) {
      return errorResponse(504, ERROR_CODES.timeout, "The inference service took too long to respond. Try again.");
    }
    if (signal.aborted) return new Response(null, { status: 499 });
    console.error("[generate] upstream unreachable", error);
    return errorResponse(502, ERROR_CODES.upstream, "Can't reach the inference service right now. Try again shortly.");
  }

  if (!upstream.ok) return mapUpstreamError(upstream);

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType.includes(NDJSON_CONTENT_TYPE) && upstream.body) {
    return ndjsonResponse(relayStream(upstream.body), signal);
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    return errorResponse(502, ERROR_CODES.upstream, "The inference service returned an unreadable response.");
  }
  const parsed = SyncResultSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[generate] upstream response violates contract", z.prettifyError(parsed.error));
    return errorResponse(502, ERROR_CODES.upstream, "The inference service returned an unexpected response.");
  }
  return ndjsonResponse(syncToEvents(parsed.data), signal);
}

async function mapUpstreamError(upstream: Response): Promise<Response> {
  const retryAfter = Number(upstream.headers.get("retry-after")) || undefined;
  const body = ErrorBodySchema.safeParse(await upstream.json().catch(() => null));
  const upstreamMessage = body.success ? body.data.error.message : undefined;

  switch (upstream.status) {
    case 503:
      return errorResponse(
        503,
        ERROR_CODES.coldStart,
        upstreamMessage ?? "The model is warming up from a cold start. Try again in a moment.",
        retryAfter ?? 20,
      );
    case 429:
      return errorResponse(429, ERROR_CODES.rateLimited, "Too many generations in a short time. Wait a moment and try again.", retryAfter);
    case 400:
    case 422:
      return errorResponse(400, ERROR_CODES.invalidRequest, upstreamMessage ?? "The inference service rejected these parameters.");
    default:
      console.error("[generate] upstream error", upstream.status, upstreamMessage);
      return errorResponse(502, ERROR_CODES.upstream, "The inference service hit an error. Try again.");
  }
}

async function* relayStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  for await (const value of readNdjson(body)) {
    const event = StreamEventSchema.safeParse(value);
    if (!event.success) {
      yield { type: "error", code: ERROR_CODES.upstream, message: "The inference service sent an unexpected event." };
      return;
    }
    yield event.data;
    if (event.data.type === "result" || event.data.type === "error") return;
  }
}

async function* syncToEvents(result: z.infer<typeof SyncResultSchema>): AsyncGenerator<StreamEvent> {
  yield {
    type: "accepted",
    seed: result.images[0].seed,
    total_steps: result.params.num_inference_steps,
    num_images: result.images.length,
    model: result.model,
  };
  yield { type: "result", ...result };
}
