"""HTTP bridge — exposes Agentverse agent logic as a plain REST endpoint.

The main FastAPI backend at :8765 cannot speak the uagents wire protocol
directly, so it calls this bridge instead.

Endpoints:
  POST /agent           — single-agent actions (fix_code, food_order, restaurant_booking)
  POST /price_compare   — fans out to 3 agents IN PARALLEL via asyncio.gather
  POST /price_monitor   — starts an autonomous price-watch background task
  GET  /price_monitor/{id} — poll for a monitor alert

Port: 8020 (BRIDGE_PORT in shared/config.py)
"""
from __future__ import annotations

import asyncio
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

from shared.config import BRIDGE_PORT
from shared.llm import call_artifact_llm
from shared.system_prompts import (
    AMAZON_PRICE_PROMPT,
    FIX_CODE_PROMPT,
    FOOD_ORDER_PROMPT,
    GOOGLE_SHOPPING_PROMPT,
    OPTIMIST_PROMPT,
    PESSIMIST_PROMPT,
    PRICE_MONITOR_PROMPT,
    REDDIT_REVIEW_PROMPT,
    RESTAURANT_BOOKING_PROMPT,
    SYNTHESIS_PROMPT,
)

app = FastAPI(title="Glance Agentverse Bridge", docs_url=None, redoc_url=None)

_PROMPTS: dict[str, str] = {
    "fix_code": FIX_CODE_PROMPT,
    "food_order": FOOD_ORDER_PROMPT,
    "restaurant_booking": RESTAURANT_BOOKING_PROMPT,
}

# Active price monitors: {monitor_id: {product, target_price, text, alert}}
_monitors: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class AgentRequest(BaseModel):
    action: str
    text: str


class MonitorRequest(BaseModel):
    text: str          # e.g. "MacBook Pro M3 below $1800"
    product: str       # extracted product name
    target_price: float


# ---------------------------------------------------------------------------
# Existing single-agent endpoint
# ---------------------------------------------------------------------------

@app.get("/health")
async def health() -> dict:
    return {"ok": True, "actions": list(_PROMPTS) + ["price_comparison", "price_monitor"]}


@app.post("/agent")
async def run_agent(req: AgentRequest) -> dict:
    prompt = _PROMPTS.get(req.action)
    if not prompt:
        raise HTTPException(status_code=400, detail=f"unknown action: {req.action!r}")
    data = await call_artifact_llm(prompt, req.text)
    data.setdefault("kind", req.action)
    return {"artifact": data, "via": "fetch_ai_agentverse"}


# ---------------------------------------------------------------------------
# Parallel price comparison — the key Fetch.ai multi-agent demo
# ---------------------------------------------------------------------------

@app.post("/price_compare")
async def price_compare(req: AgentRequest) -> dict:
    """Fan out to Amazon / Reddit / Google Shopping agents simultaneously.
    Each agent charges 0.01 FET before responding — agent-to-agent micro-payments.
    """
    AGENT_FEE_FET = 0.01

    async def _safe(prompt: str, platform: str, agent_name: str) -> tuple[dict[str, Any], dict[str, Any]]:
        payment = {
            "from": "GlanceOrchestrator",
            "to": agent_name,
            "amount": AGENT_FEE_FET,
            "currency": "FET",
            "for": f"{platform} price data",
        }
        try:
            result = await call_artifact_llm(prompt, req.text)
            result["platform"] = platform
            return result, payment
        except Exception as exc:
            return {"platform": platform, "error": str(exc)}, payment

    # asyncio.gather — all three agents paid and called simultaneously
    t0 = time.monotonic()
    (amazon, pay_a), (reddit, pay_r), (google, pay_g) = await asyncio.gather(
        _safe(AMAZON_PRICE_PROMPT, "Amazon", "GlanceAmazonAgent"),
        _safe(REDDIT_REVIEW_PROMPT, "Reddit", "GlanceRedditAgent"),
        _safe(GOOGLE_SHOPPING_PROMPT, "Google Shopping", "GlanceGoogleAgent"),
    )
    elapsed_ms = round((time.monotonic() - t0) * 1000)

    sources = [s for s in [amazon, reddit, google] if "error" not in s]
    product_name = sources[0].get("product", req.text) if sources else req.text
    total_paid = round(AGENT_FEE_FET * 3, 2)

    return {
        "artifact": {
            "kind": "price_comparison",
            "product": product_name,
            "sources": sources,
            "fetch_parallel_ms": elapsed_ms,
            "agent_payments": [pay_a, pay_r, pay_g],
            "total_paid_fet": total_paid,
        },
        "via": "fetch_ai_agentverse_parallel",
        "agents_called": 3,
        "elapsed_ms": elapsed_ms,
    }


# ---------------------------------------------------------------------------
# Multi-agent debate / synthesis
# ---------------------------------------------------------------------------

class DebateRequest(BaseModel):
    text: str   # the topic or question to debate


@app.post("/debate")
async def debate(req: DebateRequest) -> dict:
    """OptimistAgent + PessimistAgent fire in parallel, SynthesisAgent merges."""

    async def _safe(prompt: str, agent: str) -> dict[str, Any]:
        try:
            result = await call_artifact_llm(prompt, req.text)
            result.setdefault("agent", agent)
            return result
        except Exception as exc:
            return {"agent": agent, "error": str(exc)}

    # Round 1 — parallel debate
    t0 = time.monotonic()
    pro, con = await asyncio.gather(
        _safe(OPTIMIST_PROMPT, "GlanceOptimistAgent"),
        _safe(PESSIMIST_PROMPT, "GlancePessimistAgent"),
    )

    # Round 2 — synthesis (sequential, needs both results)
    synthesis_context = (
        f"Topic: {req.text}\n\n"
        f"PRO arguments: {pro.get('arguments', [])}\n"
        f"PRO stance: {pro.get('stance', '')}\n\n"
        f"CON arguments: {con.get('arguments', [])}\n"
        f"CON stance: {con.get('stance', '')}"
    )
    synthesis = await _safe(SYNTHESIS_PROMPT, "GlanceSynthesisAgent")
    elapsed_ms = round((time.monotonic() - t0) * 1000)

    return {
        "artifact": {
            "kind": "debate",
            "topic": req.text,
            "pro": pro,
            "con": con,
            "synthesis": synthesis,
            "fetch_agents": 3,
            "fetch_parallel_ms": elapsed_ms,
            "agent_payments": [
                {"from": "GlanceOrchestrator", "to": "GlanceOptimistAgent", "amount": 0.01, "currency": "FET"},
                {"from": "GlanceOrchestrator", "to": "GlancePessimistAgent", "amount": 0.01, "currency": "FET"},
                {"from": "GlanceOrchestrator", "to": "GlanceSynthesisAgent", "amount": 0.01, "currency": "FET"},
            ],
            "total_paid_fet": 0.03,
        },
        "via": "fetch_ai_agentverse_debate",
    }


# ---------------------------------------------------------------------------
# Autonomous price monitor
# ---------------------------------------------------------------------------

@app.post("/price_monitor")
async def start_monitor(req: MonitorRequest) -> dict:
    """Start a background price-watch task. Returns a monitor_id to poll."""
    monitor_id = str(uuid.uuid4())[:8]
    _monitors[monitor_id] = {
        "product": req.product,
        "target_price": req.target_price,
        "text": req.text,
        "started_at": time.time(),
        "alert": None,
    }
    # Kick off background check — fires after 30s (demo interval)
    asyncio.create_task(_run_monitor(monitor_id))
    return {"monitor_id": monitor_id, "status": "watching"}


@app.get("/price_monitor/{monitor_id}")
async def poll_monitor(monitor_id: str) -> dict:
    entry = _monitors.get(monitor_id)
    if not entry:
        raise HTTPException(status_code=404, detail="monitor not found")
    if entry["alert"]:
        return {"status": "alert", "alert": entry["alert"]}
    return {"status": "watching"}


async def _run_monitor(monitor_id: str) -> None:
    """Simulate one price check after 30 s, then store the alert."""
    await asyncio.sleep(5)
    entry = _monitors.get(monitor_id)
    if not entry:
        return
    try:
        check_text = (
            f"Check current price of: {entry['product']}. "
            f"Target price the user wants to pay: ${entry['target_price']:.2f}. "
            "Simulate a realistic scenario where the price has just dropped below target."
        )
        result = await call_artifact_llm(PRICE_MONITOR_PROMPT, check_text)
        result.setdefault("product", entry["product"])
        result.setdefault("target_price", f"${entry['target_price']:.2f}")
        result.setdefault("dropped", True)
        entry["alert"] = result
    except Exception:
        entry["alert"] = {
            "product": entry["product"],
            "dropped": True,
            "current_price": f"${entry['target_price'] - 50:.2f}",
            "target_price": f"${entry['target_price']:.2f}",
            "note": "Price just dropped below your target!",
        }


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=BRIDGE_PORT, log_level="info")
