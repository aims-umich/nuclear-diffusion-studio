"""Pinned model weights and the one-time download that bakes them into an image.

The Modal image copies only this file before running it, so changing a
revision here (and nothing else) is what triggers a fresh weights layer.

    python weights.py /weights
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

MODEL_ID = "kumo24/sdxl_nuclear"
MODEL_REVISION = "7e67d4f2dc357ef7871b68ff3a778e7cdd0a95e6"
BASE_ID = "stabilityai/stable-diffusion-xl-base-1.0"
BASE_REVISION = "462165984030d82259a11f4367a4eed129e94a7b"

# Everything the SDXL pipeline needs except its UNet, which the fine-tune replaces.
BASE_FILES = [
    "model_index.json",
    "scheduler/scheduler_config.json",
    "text_encoder/config.json",
    "text_encoder/model.fp16.safetensors",
    "text_encoder_2/config.json",
    "text_encoder_2/model.fp16.safetensors",
    "tokenizer/*",
    "tokenizer_2/*",
    "vae/config.json",
    "vae/diffusion_pytorch_model.fp16.safetensors",
]


def base_dir(root: Path) -> Path:
    return root / "base"


def unet_dir(root: Path) -> Path:
    return root / "unet"


def download(root: Path) -> None:
    """Download the base pipeline and store the fine-tuned UNet in fp16.

    The published UNet is a 10 GB fp32 checkpoint. The model card loads it with
    `torch_dtype=torch.float16`, so casting once here is bit-identical to what
    every load would do, and halves what a cold start reads from disk.
    """
    import torch
    from diffusers import UNet2DConditionModel
    from huggingface_hub import snapshot_download

    snapshot_download(BASE_ID, revision=BASE_REVISION, allow_patterns=BASE_FILES, local_dir=base_dir(root))

    with tempfile.TemporaryDirectory() as cache:
        unet = UNet2DConditionModel.from_pretrained(
            MODEL_ID,
            revision=MODEL_REVISION,
            dtype=torch.float16,
            use_safetensors=True,
            cache_dir=cache,
        )
        unet.save_pretrained(unet_dir(root), safe_serialization=True)
    shutil.rmtree(base_dir(root) / ".cache", ignore_errors=True)


if __name__ == "__main__":
    download(Path(sys.argv[1]))
