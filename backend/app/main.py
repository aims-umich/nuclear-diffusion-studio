"""The inference service: `POST /generate`, streaming the NDJSON contract in docs/API.md.

`create_app` takes the engine as an argument, so the same app runs on Modal
(`deploy/modal_app.py`), under plain uvicorn, and in tests with a fake engine.
"""

from __future__ import annotations

import asyncio
import base64
import hmac
import json
import logging
import secrets
import threading
import time
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from app.engine import Engine, GenerationCancelled, GenerationError
from app.ratelimit import RateLimiter
from app.schemas import GenerateRequest, seed_for_image

log = logging.getLogger("nuclear_diffusion")

NDJSON_CONTENT_TYPE = "application/x-ndjson"


def create_app(engine: Engine, token: str | None = None, limiter: RateLimiter | None = None) -> FastAPI:
    """Build the app. With `token` set, every request must send `Authorization: Bearer <token>`."""
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    # One generation on the GPU at a time; the rest wait their turn.
    gpu = threading.Lock()

    @app.post("/generate", response_model=None)
    async def generate(request: Request) -> JSONResponse | StreamingResponse:
        if token is not None and not _authorized(request, token):
            return _error(401, "ERR_UNAUTHORIZED", "Missing or invalid bearer token.")

        try:
            params = GenerateRequest.model_validate_json(await request.body())
        except ValidationError as error:
            return _error(400, "ERR_INVALID_REQUEST", _describe(error))

        if limiter is not None:
            retry_after = limiter.acquire(_client_ip(request), params.num_images)
            if retry_after is not None:
                return _error(
                    429,
                    "ERR_RATE_LIMITED",
                    "Too many generations in a short time. Wait a moment and try again.",
                    retry_after,
                )

        seed = params.seed if params.seed is not None else secrets.randbits(32)
        return StreamingResponse(
            _events(engine, params, seed, gpu),
            media_type=NDJSON_CONTENT_TYPE,
            headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"},
        )

    return app


async def _events(engine: Engine, params: GenerateRequest, seed: int, gpu: threading.Lock) -> AsyncIterator[bytes]:
    yield _line(
        {
            "type": "accepted",
            "seed": seed,
            "total_steps": params.num_inference_steps,
            "num_images": params.num_images,
            "model": engine.model,
        }
    )

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[int | None] = asyncio.Queue()
    stop = threading.Event()

    def on_step(step: int) -> bool:
        loop.call_soon_threadsafe(queue.put_nowait, step)
        return not stop.is_set()

    def run() -> tuple[list[bytes], float]:
        with gpu:
            if stop.is_set():
                raise GenerationCancelled
            started = time.perf_counter()
            pngs = engine.generate(params, seed, on_step)
            return pngs, (time.perf_counter() - started) * 1000

    def finished(future: asyncio.Future) -> None:
        # Retrieve the outcome so an abandoned run never logs "exception was never retrieved".
        if not future.cancelled():
            future.exception()
        queue.put_nowait(None)

    worker = asyncio.ensure_future(asyncio.to_thread(run))
    worker.add_done_callback(finished)

    try:
        while (step := await queue.get()) is not None:
            yield _line({"type": "progress", "step": step, "total_steps": params.num_inference_steps})
        pngs, timing_ms = worker.result()
    except GenerationCancelled:
        return
    except GenerationError as error:
        yield _line({"type": "error", "code": "ERR_INFERENCE", "message": str(error)})
        return
    except Exception:
        log.exception("generation failed")
        yield _line({"type": "error", "code": "ERR_INFERENCE", "message": "Generation failed unexpectedly. Try again."})
        return
    finally:
        # Set on every exit, including the client disconnecting, so the GPU stops at the next step.
        stop.set()

    log.info(
        "generated %d image(s) at %dx%d, %d steps, in %.1fs",
        params.num_images,
        params.width,
        params.height,
        params.num_inference_steps,
        timing_ms / 1000,
    )
    applied: dict[str, object] = {
        "prompt": params.prompt,
        "num_inference_steps": params.num_inference_steps,
        "guidance_scale": params.guidance_scale,
        "width": params.width,
        "height": params.height,
        "num_images": params.num_images,
        "scheduler": engine.scheduler,
        "prompt_truncated": engine.is_truncated(params.prompt),
        "negative_prompt_truncated": params.negative_prompt is not None and engine.is_truncated(params.negative_prompt),
    }
    if params.negative_prompt is not None:
        applied["negative_prompt"] = params.negative_prompt
    yield _line(
        {
            "type": "result",
            "images": [
                {"image": "data:image/png;base64," + base64.b64encode(png).decode("ascii"), "seed": seed_for_image(seed, i)}
                for i, png in enumerate(pngs)
            ],
            "params": applied,
            "timing_ms": round(timing_ms),
            "model": engine.model,
        }
    )


def _authorized(request: Request, token: str) -> bool:
    scheme, _, given = request.headers.get("authorization", "").partition(" ")
    return scheme.lower() == "bearer" and hmac.compare_digest(given.encode(), token.encode())


def _client_ip(request: Request) -> str:
    """The browser's IP: the proxy forwards it, since the backend otherwise only sees the proxy."""
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"


def _describe(error: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(part) for part in issue['loc'])}: {issue['msg']}" if issue["loc"] else issue["msg"]
        for issue in error.errors()
    )


def _error(status: int, code: str, message: str, retry_after_s: int | None = None) -> JSONResponse:
    body: dict[str, object] = {"code": code, "message": message}
    headers = {"Cache-Control": "no-store"}
    if retry_after_s is not None:
        body["retry_after_s"] = retry_after_s
        headers["Retry-After"] = str(retry_after_s)
    return JSONResponse({"error": body}, status_code=status, headers=headers)


def _line(event: dict[str, object]) -> bytes:
    return (json.dumps(event, separators=(",", ":")) + "\n").encode()
