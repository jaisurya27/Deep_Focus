"""FastAPI entry point for the Deep Focus local backend."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.providers import (
    get_chat_provider,
    get_image_provider,
    get_vision_provider,
)
from app.routes.chat import router as chat_router
from app.routes.image import router as image_router
from app.routes.session import router as session_router
from app.routes.vision import router as vision_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Deep Focus Backend",
    version="0.3.0",
    description="Local-only API for the Deep Focus desktop agent.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id"],
)

app.include_router(chat_router)
app.include_router(vision_router)
app.include_router(image_router)
app.include_router(session_router)


def _safe_probe(resolver):
    try:
        p = resolver()
        return p.name, p.model, None
    except Exception as exc:  # noqa: BLE001
        return None, None, str(exc)


@app.get("/health", tags=["meta"])
def health() -> dict:
    available: list[str] = []
    if settings.xai_api_key:
        available.append("xai")
    if settings.openai_api_key:
        available.append("openai")
    if not available:
        available.append("mock")

    chat_name, chat_model, chat_err = _safe_probe(get_chat_provider)
    vis_name, vis_model, vis_err = _safe_probe(get_vision_provider)
    img_name, img_model, img_err = _safe_probe(get_image_provider)

    return {
        "ok": True,
        "providers": available,
        "chat_provider_setting": settings.chat_provider,
        "vision_provider_setting": settings.vision_provider,
        "image_provider_setting": settings.image_provider,
        "active_provider": chat_name,
        "active_model": chat_model,
        "active_error": chat_err,
        "vision_active_provider": vis_name,
        "vision_active_model": vis_model,
        "vision_active_error": vis_err,
        "image_active_provider": img_name,
        "image_active_model": img_model,
        "image_active_error": img_err,
    }


@app.on_event("startup")
async def _on_startup() -> None:
    from app.store.memory import store

    store.purge_older_than(days=14)
    logger.info(
        "Deep Focus backend ready on %s:%s — providers=%s",
        settings.backend_host,
        settings.backend_port,
        [p for p in ("xai" if settings.xai_api_key else None, "openai" if settings.openai_api_key else None) if p]
        or ["mock"],
    )
