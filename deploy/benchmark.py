"""Benchmark candidate GPUs on the real pipeline, to pick the cheapest per image and per visit.

    modal run deploy/benchmark.py                      # L4, A10, L40S in parallel
    modal run deploy/benchmark.py --gpus L4 --out DIR  # one GPU, sample images saved to DIR

Each run loads the pipeline from the image's baked weights, warms up, times
two single 1024x1024 images and one batch of four at 50 steps (the model
card's setting), and returns the sample images for a quality check.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import modal

from modal_app import WEIGHTS, image

# Modal list prices, $ per GPU-second (October 2026).
PRICE_PER_S = {"T4": 0.000164, "L4": 0.000222, "A10": 0.000306, "L40S": 0.000542, "A100-40GB": 0.000583}

PROMPTS = [
    "Cutaway of a pressurized-water reactor core, fuel assemblies and control rods, technical illustration",
    "Spent fuel pool from above, deep blue Cherenkov glow around the fuel racks",
    "Natural-draft cooling towers in morning fog, wide angle photograph",
]
SEED = 20261007

app = modal.App("nuclear-diffusion-studio-benchmark")


@app.cls(gpu="L4", image=image.add_local_python_source("modal_app"), timeout=1200)
class Bench:
    @modal.method()
    def run(self) -> dict:
        started = time.perf_counter()
        import torch

        from app.pipeline import SDXLEngine
        from app.schemas import GenerateRequest

        imported = time.perf_counter()
        engine = SDXLEngine.load(Path(WEIGHTS), device="cuda")
        loaded = time.perf_counter()

        def timed(prompt: str, num_images: int, steps: int = 50) -> tuple[float, list[bytes]]:
            request = GenerateRequest(prompt=prompt, num_images=num_images, num_inference_steps=steps)
            torch.cuda.synchronize()
            t0 = time.perf_counter()
            pngs = engine.generate(request, SEED, lambda step: True)
            return time.perf_counter() - t0, pngs

        timed(PROMPTS[0], 1, steps=10)  # warm-up: CUDA kernels, cuDNN autotuning
        torch.cuda.reset_peak_memory_stats()
        single_a, images_a = timed(PROMPTS[0], 1)
        single_b, images_b = timed(PROMPTS[1], 1)
        batch, images_batch = timed(PROMPTS[2], 4)

        return {
            # Plain str: torch.__version__ is a torch type the local client cannot unpickle.
            "gpu": str(torch.cuda.get_device_name()),
            "torch": str(torch.__version__),
            "cuda": str(torch.version.cuda),
            "import_s": imported - started,
            "load_s": loaded - imported,
            "single_s": [single_a, single_b],
            "batch4_s": batch,
            "peak_vram_gb": torch.cuda.max_memory_allocated() / 2**30,
            "images": images_a + images_b + images_batch,
        }


@app.local_entrypoint()
def main(gpus: str = "L4,A10,L40S", out: str = "") -> None:
    names = [name.strip() for name in gpus.split(",")]
    calls = {name: Bench.with_options(gpu=name)().run.spawn() for name in names}
    for name, call in calls.items():
        result = call.get()
        if out:
            folder = Path(out) / name
            folder.mkdir(parents=True, exist_ok=True)
            for i, png in enumerate(result["images"]):
                (folder / f"{i}.png").write_bytes(png)
        per_image = sum(result["single_s"]) / 2
        price = PRICE_PER_S[name]
        row = {
            "gpu": name,
            "device": result["gpu"],
            "torch/cuda": f"{result['torch']}/{result['cuda']}",
            "load_s": round(result["load_s"], 1),
            "single_s": round(per_image, 2),
            "batch4_s": round(result["batch4_s"], 2),
            "peak_vram_gb": round(result["peak_vram_gb"], 1),
            "usd_per_image": round(per_image * price, 5),
            "usd_per_image_in_batch4": round(result["batch4_s"] / 4 * price, 5),
        }
        print(json.dumps(row))
