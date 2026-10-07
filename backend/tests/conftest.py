from __future__ import annotations

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.engine import GenerationCancelled, StepCallback
from app.main import create_app
from app.schemas import GenerateRequest

TOKEN = "test-token"


class FakeEngine:
    """Stands in for SDXL: one callback per step, one tiny 'PNG' per image."""

    model = "kumo24/sdxl_nuclear"
    scheduler = "euler"

    def __init__(self, step_delay_s: float = 0.0, error: Exception | None = None) -> None:
        self.step_delay_s = step_delay_s
        self.error = error
        self.calls: list[tuple[GenerateRequest, int]] = []
        self.stopped_at: int | None = None
        self.done = threading.Event()

    def is_truncated(self, text: str) -> bool:
        return len(text.split()) > 75

    def generate(self, request: GenerateRequest, seed: int, on_step: StepCallback) -> list[bytes]:
        self.calls.append((request, seed))
        try:
            if self.error is not None:
                raise self.error
            for step in range(1, request.num_inference_steps + 1):
                time.sleep(self.step_delay_s)
                if not on_step(step):
                    self.stopped_at = step
                    raise GenerationCancelled
            return [f"png-{i}".encode() for i in range(request.num_images)]
        finally:
            self.done.set()


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def client(engine: FakeEngine) -> TestClient:
    return TestClient(create_app(engine, token=TOKEN))


def auth(token: str = TOKEN) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def events(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]
