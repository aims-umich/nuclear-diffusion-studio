from __future__ import annotations

import asyncio
import base64
import threading

import pytest
from fastapi.testclient import TestClient

from app.engine import GenerationError
from app.main import _events, create_app
from app.ratelimit import RateLimiter
from app.schemas import GenerateRequest

from conftest import FakeEngine, auth, events


def test_streams_accepted_then_one_progress_per_step_then_result(client: TestClient) -> None:
    response = client.post("/generate", json={"prompt": "a reactor", "num_inference_steps": 12, "seed": 7}, headers=auth())

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert response.headers["cache-control"] == "no-store, no-transform"
    stream = events(response)
    assert stream[0] == {"type": "accepted", "seed": 7, "total_steps": 12, "num_images": 1, "model": "kumo24/sdxl_nuclear"}
    assert [event["step"] for event in stream[1:-1]] == list(range(1, 13))
    assert all(event == {"type": "progress", "step": event["step"], "total_steps": 12} for event in stream[1:-1])
    result = stream[-1]
    assert result["type"] == "result"
    assert result["model"] == "kumo24/sdxl_nuclear"
    assert isinstance(result["timing_ms"], int)
    assert result["params"] == {
        "prompt": "a reactor",
        "num_inference_steps": 12,
        "guidance_scale": 5.0,
        "width": 1024,
        "height": 1024,
        "num_images": 1,
        "scheduler": "euler",
        "prompt_truncated": False,
        "negative_prompt_truncated": False,
    }


def test_batch_images_are_png_data_urls_with_consecutive_seeds_wrapping_at_uint32(client: TestClient) -> None:
    response = client.post("/generate", json={"prompt": "x", "num_images": 3, "seed": 4294967295}, headers=auth())

    images = events(response)[-1]["images"]
    assert [image["seed"] for image in images] == [4294967295, 0, 1]
    assert [base64.b64decode(image["image"].removeprefix("data:image/png;base64,")) for image in images] == [
        b"png-0",
        b"png-1",
        b"png-2",
    ]


def test_random_seed_when_omitted_is_reported_and_used(client: TestClient, engine: FakeEngine) -> None:
    stream = events(client.post("/generate", json={"prompt": "x"}, headers=auth()))

    seed = stream[0]["seed"]
    assert 0 <= seed <= 4294967295
    assert engine.calls[0][1] == seed
    assert stream[-1]["images"][0]["seed"] == seed


def test_applies_defaults_and_echoes_trimmed_text(client: TestClient, engine: FakeEngine) -> None:
    stream = events(client.post("/generate", json={"prompt": "  a reactor  ", "negative_prompt": " blur "}, headers=auth()))

    request = engine.calls[0][0]
    assert (request.num_inference_steps, request.guidance_scale, request.width, request.height, request.num_images) == (
        50,
        5.0,
        1024,
        1024,
        1,
    )
    assert stream[-1]["params"]["prompt"] == "a reactor"
    assert stream[-1]["params"]["negative_prompt"] == "blur"


def test_blank_negative_prompt_is_treated_as_absent(client: TestClient, engine: FakeEngine) -> None:
    stream = events(client.post("/generate", json={"prompt": "x", "negative_prompt": "   "}, headers=auth()))

    assert engine.calls[0][0].negative_prompt is None
    assert "negative_prompt" not in stream[-1]["params"]


def test_reports_truncated_prompts(client: TestClient) -> None:
    long = " ".join(["word"] * 80)
    params = events(client.post("/generate", json={"prompt": long, "negative_prompt": long}, headers=auth()))[-1]["params"]

    assert params["prompt_truncated"] is True
    assert params["negative_prompt_truncated"] is True


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"prompt": ""},
        {"prompt": "   "},
        {"prompt": "x" * 501},
        {"prompt": "x", "negative_prompt": "x" * 501},
        {"prompt": "x", "unknown": 1},
        {"prompt": "x", "width": 512, "height": 512},
        {"prompt": "x", "width": 1024, "height": 768},
        {"prompt": "x", "num_inference_steps": 9},
        {"prompt": "x", "num_inference_steps": 51},
        {"prompt": "x", "num_inference_steps": 20.5},
        {"prompt": "x", "num_inference_steps": "20"},
        {"prompt": "x", "guidance_scale": 0.5},
        {"prompt": "x", "guidance_scale": 15.5},
        {"prompt": "x", "num_images": 0},
        {"prompt": "x", "num_images": 5},
        {"prompt": "x", "seed": -1},
        {"prompt": "x", "seed": 4294967296},
        ["not", "an", "object"],
    ],
)
def test_rejects_requests_outside_the_contract(client: TestClient, engine: FakeEngine, body: object) -> None:
    response = client.post("/generate", json=body, headers=auth())

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "ERR_INVALID_REQUEST"
    assert response.json()["error"]["message"]
    assert engine.calls == []


def test_rejects_a_body_that_is_not_json(client: TestClient) -> None:
    response = client.post("/generate", content=b"{nope", headers={**auth(), "Content-Type": "application/json"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "ERR_INVALID_REQUEST"


@pytest.mark.parametrize("size", [(1024, 1024), (1152, 896), (896, 1152), (1216, 832), (832, 1216), (1344, 768)])
def test_accepts_every_sdxl_preset(client: TestClient, size: tuple[int, int]) -> None:
    width, height = size
    response = client.post("/generate", json={"prompt": "x", "width": width, "height": height, "num_inference_steps": 10}, headers=auth())

    assert events(response)[-1]["params"]["width"] == width


def test_accepts_integer_guidance(client: TestClient) -> None:
    response = client.post("/generate", json={"prompt": "x", "guidance_scale": 7, "num_inference_steps": 10}, headers=auth())

    assert events(response)[-1]["params"]["guidance_scale"] == 7.0


@pytest.mark.parametrize("headers", [{}, auth("wrong"), {"Authorization": "test-token"}, {"Authorization": "Basic test-token"}])
def test_requires_the_bearer_token(client: TestClient, engine: FakeEngine, headers: dict[str, str]) -> None:
    response = client.post("/generate", json={"prompt": "x"}, headers=headers)

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "ERR_UNAUTHORIZED"
    assert engine.calls == []


def test_no_token_configured_means_no_auth(engine: FakeEngine) -> None:
    client = TestClient(create_app(engine))

    assert client.post("/generate", json={"prompt": "x", "num_inference_steps": 10}).status_code == 200


def test_serves_no_docs_or_schema(client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_known_inference_failures_are_reported_in_band() -> None:
    client = TestClient(create_app(FakeEngine(error=GenerationError("The GPU ran out of memory. Try fewer images per run."))))

    stream = events(client.post("/generate", json={"prompt": "x"}))

    assert stream[0]["type"] == "accepted"
    assert stream[-1] == {"type": "error", "code": "ERR_INFERENCE", "message": "The GPU ran out of memory. Try fewer images per run."}


def test_unexpected_failures_do_not_leak_details() -> None:
    client = TestClient(create_app(FakeEngine(error=RuntimeError("secret internals"))))

    stream = events(client.post("/generate", json={"prompt": "x"}))

    assert stream[-1] == {"type": "error", "code": "ERR_INFERENCE", "message": "Generation failed unexpectedly. Try again."}


def test_rate_limits_images_per_forwarded_client_ip(engine: FakeEngine) -> None:
    limiter = RateLimiter({}, max_images=4, window_s=3600, clock=lambda: 1000.0)
    client = TestClient(create_app(engine, limiter=limiter))
    body = {"prompt": "x", "num_images": 3, "num_inference_steps": 10}

    assert client.post("/generate", json=body, headers={"X-Forwarded-For": "1.1.1.1"}).status_code == 200
    limited = client.post("/generate", json=body, headers={"X-Forwarded-For": "1.1.1.1, 10.0.0.1"})
    other_client = client.post("/generate", json=body, headers={"X-Forwarded-For": "2.2.2.2"})

    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "ERR_RATE_LIMITED"
    assert limited.headers["retry-after"] == "3600"
    assert limited.json()["error"]["retry_after_s"] == 3600
    assert other_client.status_code == 200
    assert len(engine.calls) == 2


def test_stops_the_engine_when_the_client_goes_away() -> None:
    engine = FakeEngine(step_delay_s=0.01)
    request = GenerateRequest(prompt="x", num_inference_steps=50)

    async def read_two_events_then_disconnect() -> None:
        stream = _events(engine, request, 1, threading.Lock())
        await anext(stream)  # accepted
        await anext(stream)  # first progress
        await stream.aclose()

    asyncio.run(read_two_events_then_disconnect())

    assert engine.done.wait(timeout=2)
    assert engine.stopped_at is not None and engine.stopped_at < 50
