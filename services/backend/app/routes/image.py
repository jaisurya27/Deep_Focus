"""Image generation route — used by the Visual Metaphor preset."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.providers import get_image_provider

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/image", tags=["image"])


class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)


@router.post("")
async def generate_image(req: ImageRequest) -> dict:
    provider = get_image_provider()
    try:
        result = await provider.generate(req.prompt)
    except Exception as exc:  # noqa: BLE001
        logger.exception("image generation failed")
        raise HTTPException(
            status_code=502,
            detail=f"{provider.name} image generation failed: {exc}",
        ) from exc
    return {
        "provider": result.get("provider", provider.name),
        "model": result.get("model", provider.model),
        "dataUrl": result.get("data_url"),
        "url": result.get("url"),
    }
