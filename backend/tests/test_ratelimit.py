from __future__ import annotations

from app.ratelimit import RateLimiter


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def test_allows_up_to_the_limit_then_reports_when_the_oldest_images_age_out() -> None:
    clock = Clock()
    limiter = RateLimiter({}, max_images=4, window_s=100, clock=clock)

    assert limiter.acquire("a", 2) is None
    clock.now = 30
    assert limiter.acquire("a", 2) is None
    clock.now = 40
    # Both images from t=0 must expire (at t=100) before two more fit.
    assert limiter.acquire("a", 2) == 60
    assert limiter.acquire("a", 1) == 60


def test_window_slides() -> None:
    clock = Clock()
    limiter = RateLimiter({}, max_images=2, window_s=100, clock=clock)

    assert limiter.acquire("a", 2) is None
    clock.now = 100.5
    assert limiter.acquire("a", 2) is None


def test_rejected_requests_are_not_counted() -> None:
    clock = Clock()
    limiter = RateLimiter({}, max_images=2, window_s=100, clock=clock)

    assert limiter.acquire("a", 2) is None
    assert limiter.acquire("a", 1) is not None
    clock.now = 100.5
    assert limiter.acquire("a", 2) is None


def test_clients_are_independent() -> None:
    limiter = RateLimiter({}, max_images=1, window_s=100, clock=Clock())

    assert limiter.acquire("a", 1) is None
    assert limiter.acquire("b", 1) is None
    assert limiter.acquire("a", 1) is not None


def test_a_batch_larger_than_the_limit_never_fits() -> None:
    limiter = RateLimiter({}, max_images=2, window_s=100, clock=Clock())

    assert limiter.acquire("a", 3) == 100
