"""Per-client limit on images generated, since GPU time is the scarce resource."""

from __future__ import annotations

import math
import time
from collections.abc import Callable, MutableMapping


class RateLimiter:
    """A sliding window of at most `max_images` images per client every `window_s` seconds.

    `store` maps a client key to the timestamps of its recent images. A plain
    dict works for one process; on Modal it is a `modal.Dict`, so the limit
    holds across containers.
    """

    def __init__(
        self,
        store: MutableMapping[str, list[float]],
        max_images: int,
        window_s: float,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.store = store
        self.max_images = max_images
        self.window_s = window_s
        self.clock = clock

    def acquire(self, key: str, images: int) -> int | None:
        """Record `images` for `key`, or return how many seconds to wait if that would exceed the limit."""
        if images > self.max_images:
            return math.ceil(self.window_s)
        now = self.clock()
        recent = [t for t in self.store.get(key, []) if t > now - self.window_s]
        excess = len(recent) + images - self.max_images
        if excess > 0:
            # The oldest `excess` images have to age out of the window first.
            return max(1, math.ceil(recent[excess - 1] + self.window_s - now))
        self.store[key] = recent + [now] * images
        return None
