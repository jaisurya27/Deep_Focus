"""ConnectAgent — restaurant booking lookup (payment-gated via Orchestrator).

Only accepts RoutedRequest from the Orchestrator (payment already cleared).
Not registered with Chat Protocol directly — all user interaction flows
through the Orchestrator which handles the Payment Protocol gate.

Artifact: restaurant_booking
"""
from __future__ import annotations

import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from uagents import Agent, Context

from shared.config import CONNECT_AGENT_PORT, CONNECT_AGENT_SEED, ORCHESTRATOR_ADDRESS
from shared.formatters import format_restaurant_booking
from shared.llm import call_artifact_llm
from shared.messages import RoutedRequest, RoutedResponse
from shared.system_prompts import RESTAURANT_BOOKING_PROMPT

# ---------------------------------------------------------------------------

agent = Agent(
    name="GlanceConnectAgent",
    seed=CONNECT_AGENT_SEED,
    port=CONNECT_AGENT_PORT,
    mailbox=True,
    network="testnet",
)


async def _run_booking(text: str) -> str:
    try:
        data = await call_artifact_llm(RESTAURANT_BOOKING_PROMPT, text)
        return format_restaurant_booking(data)
    except Exception as exc:
        return f"Sorry, the restaurant lookup failed: {exc}"


@agent.on_message(RoutedRequest)
async def on_routed(ctx: Context, sender: str, msg: RoutedRequest):
    ctx.logger.info("RoutedRequest from %s | %.60s", sender, msg.text)
    result = await _run_booking(msg.text)
    await ctx.send(
        ORCHESTRATOR_ADDRESS,
        RoutedResponse(text=result, session_sender=msg.session_sender),
    )


if __name__ == "__main__":
    print(f"ConnectAgent address: {agent.address}")
    agent.run()
