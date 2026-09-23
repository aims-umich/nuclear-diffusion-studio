import {
  ERROR_CODES,
  ErrorBodySchema,
  MOCK_SCENARIO_HEADER,
  StreamEventSchema,
  type GenerateRequestInput,
  type ResultEvent,
  type StreamEvent,
} from "@/lib/contract";
import { readNdjson } from "@/lib/ndjson";

/** A failed generation, normalised from HTTP errors, stream errors, and network failures. */
export class GenerateError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(code: string, message: string, status: number | null = null, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "GenerateError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type GenerateOptions = {
  signal?: AbortSignal;
  /** Called for every event, including the terminal one. */
  onEvent?: (event: StreamEvent) => void;
  /** Forces a mock scenario (ignored by the server when proxying). */
  mockScenario?: string | null;
  endpoint?: string;
  fetchImpl?: typeof fetch;
};

/** Run one generation against /api/generate and resolve with the terminal result event. */
export async function generate(request: GenerateRequestInput, options: GenerateOptions = {}): Promise<ResultEvent> {
  const { signal, onEvent, mockScenario, endpoint = "/api/generate", fetchImpl = fetch } = options;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(mockScenario ? { [MOCK_SCENARIO_HEADER]: mockScenario } : {}),
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new GenerateError(ERROR_CODES.network, "Can't reach the server. Check your connection and try again.");
  }

  if (!response.ok) throw await toGenerateError(response);
  if (!response.body) {
    throw new GenerateError(ERROR_CODES.interrupted, "The server sent an empty response.", response.status);
  }

  try {
    for await (const value of readNdjson(response.body)) {
      const parsed = StreamEventSchema.safeParse(value);
      if (!parsed.success) {
        throw new GenerateError(ERROR_CODES.upstream, "The server sent an unexpected event.", response.status);
      }
      const event = parsed.data;
      onEvent?.(event);
      if (event.type === "result") return event;
      if (event.type === "error") throw new GenerateError(event.code, event.message, response.status);
    }
  } catch (error) {
    if (error instanceof GenerateError || signal?.aborted) throw error;
    throw new GenerateError(ERROR_CODES.interrupted, "The connection dropped mid-generation. Try again.", response.status);
  }
  throw new GenerateError(ERROR_CODES.interrupted, "The generation ended before an image arrived. Try again.", response.status);
}

async function toGenerateError(response: Response): Promise<GenerateError> {
  const retryAfter = Number(response.headers.get("retry-after")) || null;
  const body = ErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (body.success) {
    const { code, message, retry_after_s } = body.data.error;
    return new GenerateError(code, message, response.status, retry_after_s ?? retryAfter);
  }
  return new GenerateError(
    response.status === 503 ? ERROR_CODES.coldStart : ERROR_CODES.upstream,
    `The server responded with ${response.status}.`,
    response.status,
    retryAfter,
  );
}
