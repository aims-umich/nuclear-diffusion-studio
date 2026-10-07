import { z } from "zod";
import {
  ERROR_CODES,
  GenerateRequestSchema,
  MOCK_SCENARIO_HEADER,
} from "@/lib/contract";
import {
  COLD_START_RETRY_AFTER_S,
  mockConfigFromEnv,
  parseScenario,
  pickScenario,
  runMockGeneration,
} from "@/lib/mock/engine";
import { clientIpFrom, proxyGenerate } from "@/lib/server/proxy";
import { errorResponse, ndjsonResponse } from "@/lib/server/responses";

/** Generous ceiling: a cold GPU container can take ~60s before the first step. */
export const maxDuration = 120;

const UPSTREAM_TIMEOUT_MS = 115_000;

/**
 * POST /api/generate - the one seam between the UI and inference.
 *
 * INFERENCE_API_URL unset -> serve the mock engine.
 * INFERENCE_API_URL set   -> proxy to the Python inference service.
 * The response contract is identical either way (see lib/contract.ts).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, ERROR_CODES.invalidRequest, "Request body must be JSON.");
  }

  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, ERROR_CODES.invalidRequest, z.prettifyError(parsed.error));
  }

  const upstreamUrl = process.env.INFERENCE_API_URL;
  if (upstreamUrl) {
    return proxyGenerate(parsed.data, {
      baseUrl: upstreamUrl,
      token: process.env.INFERENCE_API_TOKEN,
      clientIp: clientIpFrom(request.headers),
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      signal: request.signal,
    });
  }

  const config = mockConfigFromEnv();
  const scenario = pickScenario(parseScenario(request.headers.get(MOCK_SCENARIO_HEADER)), config);
  if (scenario === "cold-start") {
    return errorResponse(
      503,
      ERROR_CODES.coldStart,
      "The model is warming up from a cold start. Give it a moment and try again.",
      COLD_START_RETRY_AFTER_S,
    );
  }
  return ndjsonResponse(runMockGeneration(parsed.data, scenario, config, request.signal), request.signal);
}
