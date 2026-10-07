"""What the web app needs from a model, so it can be tested without torch or a GPU."""

from __future__ import annotations

from collections.abc import Callable
from typing import Protocol

from app.schemas import GenerateRequest

# Called after each denoising step with the 1-based step number.
# Returning False asks the engine to stop early.
StepCallback = Callable[[int], bool]


class GenerationCancelled(Exception):
    """The caller went away mid-generation, so the engine stopped early."""


class GenerationError(Exception):
    """A failure whose message is safe and useful to show the user."""


class Engine(Protocol):
    model: str
    scheduler: str

    def is_truncated(self, text: str) -> bool:
        """True when `text` runs past the text encoders' token window."""
        ...

    def generate(self, request: GenerateRequest, seed: int, on_step: StepCallback) -> list[bytes]:
        """Run one batch and return one PNG per image, in batch order."""
        ...
