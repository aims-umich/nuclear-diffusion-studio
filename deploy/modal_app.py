"""Modal deployment of the inference service in `backend/`.

    modal serve deploy/modal_app.py    # hot-reloading dev URL
    modal deploy deploy/modal_app.py   # the stable endpoint INFERENCE_API_URL points at

This file is only a thin wrapper: the FastAPI app and the pipeline live in
`backend/app/` and run unchanged under plain uvicorn on any other GPU host.

Cost rules (AGENTS.md): serverless only. `min_containers` stays 0, so the GPU
runs only while serving a request or inside the scale-down window, and
`max_containers` caps the burn rate under the workspace budget.
"""

from __future__ import annotations

import os
from pathlib import Path

import modal

BACKEND = Path(__file__).resolve().parent.parent / "backend"
WEIGHTS = "/weights"

# The cheapest per visit (deploy/benchmark.py, docs/IMPLEMENTATION_PLAN.md Section 11): the idle
# scale-down tail is billed at the GPU rate and outweighs the faster GPUs' lower cost per image.
GPU = "L4"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(requirements=[str(BACKEND / "requirements.txt")])
    .env({"HF_HUB_DISABLE_TELEMETRY": "1", "TOKENIZERS_PARALLELISM": "false"})
    # Weights are baked into the image, so a cold start never depends on Hugging Face.
    # Only weights.py is copied first: the layer rebuilds when a pinned revision changes, not on every code edit.
    .add_local_file(BACKEND / "app" / "weights.py", "/opt/nds/weights.py", copy=True)
    .run_commands(f"python /opt/nds/weights.py {WEIGHTS}")
    .add_local_dir(BACKEND / "app", "/root/app", ignore=["**/__pycache__"])
)

app = modal.App("nuclear-diffusion-studio")

# Per-client image counts, shared by every container so the rate limit holds across them.
rate_limits = modal.Dict.from_name("nuclear-diffusion-studio-rate-limits", create_if_missing=True)
RATE_LIMIT_IMAGES = 40
RATE_LIMIT_WINDOW_S = 3600


@app.cls(
    gpu=GPU,
    image=image,
    secrets=[modal.Secret.from_name("nuclear-diffusion-studio")],  # INFERENCE_API_TOKEN
    enable_memory_snapshot=True,
    scaledown_window=60,  # seconds idle before scale-to-zero; covers a user iterating on prompts
    min_containers=0,  # always 0: serverless only, never a warm GPU
    max_containers=2,  # burn-rate ceiling; excess requests queue at Modal
    timeout=300,
)
class Inference:
    @modal.enter(snap=True)
    def load(self) -> None:
        # Imports and CPU-resident weights are captured in the memory snapshot.
        from app.pipeline import SDXLEngine

        self.engine = SDXLEngine.load(Path(WEIGHTS), device="cpu")

    @modal.enter(snap=False)
    def to_gpu(self) -> None:
        # Runs on every container start, after the snapshot is restored.
        self.engine.to("cuda")

    # Modal checks the proxy token at its edge, so a request without it never starts a GPU container.
    # The proxy sends it as `Authorization: Bearer <id>.<secret>`, which the app checks again.
    @modal.asgi_app(requires_proxy_auth=True)
    def web(self):
        import logging

        from app.main import create_app
        from app.ratelimit import RateLimiter

        logging.basicConfig(level=logging.INFO)
        return create_app(
            self.engine,
            token=os.environ["INFERENCE_API_TOKEN"],
            limiter=RateLimiter(rate_limits, max_images=RATE_LIMIT_IMAGES, window_s=RATE_LIMIT_WINDOW_S),
        )
