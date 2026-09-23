# `/api/generate` contract

The single seam between the NuclearDiffusion Studio UI and inference.
The machine-readable source of truth is `frontend/lib/contract.ts`; this document describes the same contract at the wire level for whoever builds the Python inference service (Track B).

The browser only ever talks to the Next.js route handler at `POST /api/generate`.
When `INFERENCE_API_URL` is unset, that handler serves a built-in mock engine.
When it is set, the handler validates the request and forwards it to `POST {INFERENCE_API_URL}/generate`, so **the inference service implements exactly this contract**.

## Request

`POST /generate` with `Content-Type: application/json`.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `prompt` | string | required | Trimmed, 1-500 characters |
| `negative_prompt` | string | omitted | Trimmed, up to 500 characters |
| `num_inference_steps` | integer | 30 | 10-50 |
| `guidance_scale` | number | 7.5 | 1-15 |
| `width` | integer | 1024 | One of 512, 768, 1024 |
| `height` | integer | 1024 | One of 512, 768, 1024 |
| `seed` | integer | random | 0-4294967295 (uint32). Omit for a random seed |

Unknown fields are rejected.
The proxy sends `Authorization: Bearer $INFERENCE_API_TOKEN` when that variable is set.

## Successful response: an NDJSON stream

Status `200`, `Content-Type: application/x-ndjson`, one JSON object per line:

1. exactly one `accepted` event, first;
2. zero or more `progress` events, one per denoising step;
3. exactly one terminal event, `result` or `error`.

```jsonc
{"type":"accepted","seed":742199304,"total_steps":30,"model":"kumo24/sdxl_nuclear"}
{"type":"progress","step":1,"total_steps":30}
// ...
{"type":"progress","step":30,"total_steps":30}
{"type":"result","image":"data:image/png;base64,...","seed":742199304,"params":{"prompt":"...","num_inference_steps":30,"guidance_scale":7.5,"width":1024,"height":1024,"scheduler":"euler_a"},"timing_ms":3240,"model":"kumo24/sdxl_nuclear"}
```

- `seed` is always the seed actually used, so a result can be reproduced exactly.
- `params` echoes the applied parameters plus `scheduler`, the diffusers scheduler that ran (for example `euler_a`).
- `image` is a `data:` URL (PNG from the model) or an `https` URL if a storage layer is added later.
- A failure after streaming has begun is reported in-band:

```json
{"type":"error","code":"ERR_INFERENCE","message":"CUDA out of memory. Try a smaller size."}
```

In diffusers, `progress` events map directly onto the pipeline's per-step `callback_on_step_end`.

### Simpler alternative for the backend

If streaming is not ready yet, the service may instead answer `200` with a single JSON body:

```json
{"image":"data:image/png;base64,...","seed":742199304,"params":{"prompt":"...","num_inference_steps":30,"guidance_scale":7.5,"width":1024,"height":1024,"scheduler":"euler_a"},"timing_ms":3240,"model":"kumo24/sdxl_nuclear"}
```

The proxy converts it into `accepted` plus `result`.
The UI still works; it just shows no step-by-step progress.

## Error responses

Any non-2xx response has this body:

```json
{"error":{"code":"ERR_COLD_START","message":"The model is warming up from a cold start.","retry_after_s":20}}
```

How the proxy maps upstream statuses to what the browser sees:

| Upstream status | Browser sees | Code |
| --- | --- | --- |
| `503` (warming, scaling from zero) | `503` + `Retry-After` | `ERR_COLD_START` |
| `429` | `429` | `ERR_RATE_LIMITED` |
| `400` / `422` | `400` (upstream `message` passed through) | `ERR_INVALID_REQUEST` |
| other `5xx` | `502` | `ERR_UPSTREAM` |
| unreachable | `502` | `ERR_UPSTREAM` |
| no response within 115s | `504` | `ERR_TIMEOUT` |

Return `503` with a `Retry-After` header while the model loads; the UI shows it as "Reactor offline" with a retry.

## Streaming notes

- The route pads the first line with about 1 KiB of JSON whitespace so WebKit (Safari) renders progress immediately instead of buffering it.
- Responses carry `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no` so proxies do not buffer the stream.

## Mock-only controls

These are ignored in proxy mode.

- `X-ND-Mock-Scenario: ok | cold-start | inference-error | slow` forces a scenario for one request.
  In the UI, add `?mock=<scenario>` to the page URL.
- `MOCK_COLD_START_RATE`, `MOCK_ERROR_RATE`, and `MOCK_SPEED` tune the mock's randomness and latency (see `frontend/.env.example`).
