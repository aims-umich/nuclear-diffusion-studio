"""The `POST /generate` request, mirroring `frontend/lib/contract.ts` (see docs/API.md)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

PROMPT_MAX_LENGTH = 500
SEED_MAX = 2**32 - 1

# SDXL-native sizes; the fine-tune was trained only on 1024x1024.
SIZE_PRESETS = {
    (1024, 1024),
    (1152, 896),
    (896, 1152),
    (1216, 832),
    (832, 1216),
    (1344, 768),
}


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True, frozen=True)

    prompt: str = Field(min_length=1, max_length=PROMPT_MAX_LENGTH)
    negative_prompt: str | None = Field(default=None, max_length=PROMPT_MAX_LENGTH)
    num_inference_steps: int = Field(default=50, ge=10, le=50)
    guidance_scale: float = Field(default=5.0, ge=1, le=15)
    width: int = 1024
    height: int = 1024
    num_images: int = Field(default=1, ge=1, le=4)
    seed: int | None = Field(default=None, ge=0, le=SEED_MAX)

    @field_validator("negative_prompt")
    @classmethod
    def _blank_negative_is_none(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _check_size(self) -> GenerateRequest:
        if (self.width, self.height) not in SIZE_PRESETS:
            sizes = ", ".join(f"{w}x{h}" for w, h in sorted(SIZE_PRESETS))
            raise ValueError(f"Size must be one of {sizes}")
        return self


def seed_for_image(base_seed: int, index: int) -> int:
    """Image `index` of a batch uses the base seed plus its index, wrapping within uint32."""
    return (base_seed + index) % 2**32
