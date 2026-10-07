"""The real engine: the fine-tuned SDXL UNet inside the stock SDXL base pipeline."""

from __future__ import annotations

import io
import os
import warnings
from pathlib import Path
from typing import TYPE_CHECKING

# Before diffusers is imported: importing it already logs transformers notices (e.g. torchvision being absent).
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")

import torch
from diffusers import StableDiffusionXLPipeline, UNet2DConditionModel
from diffusers.utils import logging as diffusers_logging
from transformers.utils import logging as transformers_logging

from app.engine import GenerationCancelled, GenerationError, StepCallback
from app.schemas import GenerateRequest, seed_for_image
from app.weights import MODEL_ID, base_dir, unet_dir

if TYPE_CHECKING:
    from PIL.Image import Image


# Keep container logs to what matters: no progress bars, and none of the expected notices about
# loading fp16 weights on the CPU first or the pipeline upcasting the VAE for each decode.
diffusers_logging.set_verbosity_error()
diffusers_logging.disable_progress_bar()
transformers_logging.set_verbosity_error()
transformers_logging.disable_progress_bar()
warnings.filterwarnings("ignore", message="`upcast_vae` is deprecated", category=FutureWarning)


def load_pipeline(weights: Path, device: str) -> StableDiffusionXLPipeline:
    unet = UNet2DConditionModel.from_pretrained(unet_dir(weights), dtype=torch.float16)
    pipe = StableDiffusionXLPipeline.from_pretrained(
        base_dir(weights),
        unet=unet,
        dtype=torch.float16,
        variant="fp16",
        use_safetensors=True,
    )
    # Decode a batch one image at a time so four 1-megapixel images do not spike VRAM.
    pipe.vae.enable_slicing()
    pipe.set_progress_bar_config(disable=True)
    return pipe.to(device)


class SDXLEngine:
    model = MODEL_ID
    # The base pipeline's default, EulerDiscreteScheduler.
    scheduler = "euler"

    def __init__(self, pipe: StableDiffusionXLPipeline) -> None:
        self.pipe = pipe

    @classmethod
    def load(cls, weights: Path, device: str = "cuda") -> SDXLEngine:
        return cls(load_pipeline(weights, device))

    def to(self, device: str) -> None:
        self.pipe.to(device)

    def is_truncated(self, text: str) -> bool:
        tokenizer = self.pipe.tokenizer
        return len(tokenizer(text).input_ids) > tokenizer.model_max_length

    def generate(self, request: GenerateRequest, seed: int, on_step: StepCallback) -> list[bytes]:
        device = self.pipe.device
        generators = [
            torch.Generator(device).manual_seed(seed_for_image(seed, i)) for i in range(request.num_images)
        ]
        cancelled = False

        def step_end(pipe: StableDiffusionXLPipeline, step_index: int, timestep: int, kwargs: dict) -> dict:
            nonlocal cancelled
            if not on_step(step_index + 1):
                cancelled = True
                pipe._interrupt = True
            return kwargs

        try:
            images: list[Image] = self.pipe(
                prompt=request.prompt,
                negative_prompt=request.negative_prompt,
                num_inference_steps=request.num_inference_steps,
                guidance_scale=request.guidance_scale,
                width=request.width,
                height=request.height,
                num_images_per_prompt=request.num_images,
                generator=generators,
                callback_on_step_end=step_end,
            ).images
        except torch.OutOfMemoryError as error:
            torch.cuda.empty_cache()
            raise GenerationError("The GPU ran out of memory. Try fewer images per run.") from error

        if cancelled:
            raise GenerationCancelled
        return [_png(image) for image in images]


def _png(image: Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()
