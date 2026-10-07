# `/api/generate` contract

The single seam between the NuclearDiffusion Studio UI and inference.
The machine-readable source of truth is `frontend/lib/contract.ts`; this document describes the same contract at the wire level for whoever builds the Python inference service (Track B).

The browser only ever talks to the Next.js route handler at `POST /api/generate`.
When `INFERENCE_API_URL` is unset, that handler serves a built-in mock engine.
When it is set, the handler validates the request and forwards it to `POST {INFERENCE_API_URL}/generate`, so **the inference service implements exactly this contract**.

## What the model supports

`kumo24/sdxl_nuclear` is a fine-tuned SDXL UNet loaded into the stock `stabilityai/stable-diffusion-xl-base-1.0` pipeline, so every limit below comes from SDXL or from how the fine-tune was trained:

- **Sizes.** SDXL is built for about one megapixel and degrades well below it, so only SDXL-native sizes are accepted.
  The fine-tune was trained only on 1024x1024 images (NuclearDiffusion paper), so 1024x1024 is the default and the other sizes are offered as experimental.
- **Prompt length.** SDXL's CLIP text encoders read 77 tokens, 75 of them usable.
  The pipeline silently drops the rest, so the service reports truncation instead of hiding it.
- **Scheduler.** The base pipeline's default, `EulerDiscreteScheduler`, reported as `euler`.
- **Defaults** follow the model card and the paper: 50 steps, guidance 5.0, no negative prompt.
- **Guidance 1.0** turns classifier-free guidance off in diffusers, so a negative prompt has no effect at that value.

## Request

`POST /generate` with `Content-Type: application/json`.

| Field | Type | Default | Rules |
| --- | --- | --- | --- |
| `prompt` | string | required | Trimmed, 1-500 characters. Only the first 75 CLIP tokens reach the model |
| `negative_prompt` | string | omitted | Trimmed, up to 500 characters, same token window |
| `num_inference_steps` | integer | 50 | 10-50 |
| `guidance_scale` | number | 5.0 | 1-15 |
| `width` x `height` | integers | 1024 x 1024 | One of the pairs below |
| `num_images` | integer | 1 | 1-4, generated as one batch |
| `seed` | integer | random | 0-4294967295 (uint32). Omit for a random seed |

Allowed sizes (all SDXL-native, sides divisible by 64):

| Aspect | `width` x `height` | Status |
| --- | --- | --- |
| 1:1 | 1024 x 1024 | Trained resolution |
| 4:3 | 1152 x 896 | Experimental |
| 3:4 | 896 x 1152 | Experimental |
| 3:2 | 1216 x 832 | Experimental |
| 2:3 | 832 x 1216 | Experimental |
| 16:9 | 1344 x 768 | Experimental |

Unknown fields and any other size are rejected with `400 ERR_INVALID_REQUEST`.
The proxy sends `Authorization: Bearer $INFERENCE_API_TOKEN` when that variable is set.
It also sends `X-Forwarded-For` with the browser's IP (the first entry of the header the host set), so the service can rate-limit per visitor; it is omitted when the host reports no client IP.

## Successful response: an NDJSON stream

Status `200`, `Content-Type: application/x-ndjson`, one JSON object per line:

1. exactly one `accepted` event, first;
2. zero or more `progress` events, one per denoising step;
3. exactly one terminal event, `result` or `error`.

```jsonc
{"type":"accepted","seed":742199304,"total_steps":50,"num_images":2,"model":"kumo24/sdxl_nuclear"}
{"type":"progress","step":1,"total_steps":50}
// ...
{"type":"progress","step":50,"total_steps":50}
{"type":"result","images":[{"image":"data:image/png;base64,...","seed":742199304},{"image":"data:image/png;base64,...","seed":742199305}],"params":{"prompt":"...","num_inference_steps":50,"guidance_scale":5,"width":1024,"height":1024,"num_images":2,"scheduler":"euler","prompt_truncated":false,"negative_prompt_truncated":false},"timing_ms":14100,"model":"kumo24/sdxl_nuclear"}
```

- `accepted.seed` is the base seed actually used. Image `i` of a batch uses `(seed + i) mod 2^32`, and each entry in `images` carries its own seed, so any single image can be reproduced exactly with `num_images: 1`.
- `images` is in batch order and has exactly `num_images` entries. Each `image` is a `data:` URL (PNG from the model) or an `https` URL if a storage layer is added later.
- `params` echoes the applied parameters plus `scheduler`, the diffusers scheduler that ran (`euler`).
- `prompt_truncated` / `negative_prompt_truncated` are `true` when that text ran past the 75-token window and its tail was ignored.
  Compute them with the pipeline's own tokenizer (`len(pipe.tokenizer(text).input_ids) > pipe.tokenizer.model_max_length`); if omitted they default to `false`.
- A failure after streaming has begun is reported in-band:

```json
{"type":"error","code":"ERR_INFERENCE","message":"CUDA out of memory. Try fewer images per run."}
```

In diffusers, `progress` events map directly onto the pipeline's per-step `callback_on_step_end`, and a batch is one pipeline call:

```python
generators = [torch.Generator("cuda").manual_seed((seed + i) % 2**32) for i in range(num_images)]
pipe(prompt, negative_prompt=..., num_inference_steps=..., guidance_scale=..., width=..., height=...,
     num_images_per_prompt=num_images, generator=generators, callback_on_step_end=...)
```

Enable `pipe.enable_vae_slicing()` so decoding a batch of four 1-megapixel images does not spike VRAM.

### Simpler alternative for the backend

If streaming is not ready yet, the service may instead answer `200` with a single JSON body:

```json
{"images":[{"image":"data:image/png;base64,...","seed":742199304}],"params":{"prompt":"...","num_inference_steps":50,"guidance_scale":5,"width":1024,"height":1024,"num_images":1,"scheduler":"euler","prompt_truncated":false,"negative_prompt_truncated":false},"timing_ms":7050,"model":"kumo24/sdxl_nuclear"}
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
| other statuses (`401`, `5xx`, ...) | `502` | `ERR_UPSTREAM` |
| unreachable | `502` | `ERR_UPSTREAM` |
| no response within 115s | `504` | `ERR_TIMEOUT` |

The 115s timeout covers only the wait for the upstream to start responding; once the stream has started, it runs until its terminal event (up to the route's 300s limit).

Return `503` with a `Retry-After` header while the model loads; the UI shows it as "The model is starting up" with a retry.

The service in `backend/` answers:

- `401 ERR_UNAUTHORIZED` when it is configured with a token and the request does not carry it.
- `429 ERR_RATE_LIMITED` with `Retry-After` when a client (keyed on `X-Forwarded-For`) exceeds its image budget, 40 images per rolling hour on Modal.
- `400 ERR_INVALID_REQUEST` for anything outside the request rules above.

On Modal, a cold start never returns `503`: Modal holds the request until a container is up, so it shows up as a longer wait before `accepted`.

## Streaming notes

- The route pads the first line with about 1 KiB of JSON whitespace so WebKit (Safari) renders progress immediately instead of buffering it.
- Responses carry `Cache-Control: no-store, no-transform` and `X-Accel-Buffering: no` so proxies do not buffer the stream.

## Mock-only controls

These are ignored in proxy mode.

- `X-ND-Mock-Scenario: ok | cold-start | inference-error | slow` forces a scenario for one request.
  In the UI, add `?mock=<scenario>` to the page URL.
- `MOCK_COLD_START_RATE`, `MOCK_ERROR_RATE`, and `MOCK_SPEED` tune the mock's randomness and latency (see `frontend/.env.example`).
