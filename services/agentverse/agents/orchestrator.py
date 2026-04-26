"""GlanceOrchestratorAgent — the single ASI:One entry point for Glance.

Routing logic:
  code  → CodeAgent     (free, Chat Protocol)
  food  → DiscoverAgent (free, Chat Protocol)
  book  → ConnectAgent  (paid, Payment Protocol gate first)
  direct→ inline answer via LLM

Payment Protocol flow (Connect tier):
  1. User sends ChatMessage requesting a restaurant booking
  2. Orchestrator sends RequestPayment (0.10 FET) back to user
  3. User commits payment (CommitPayment)
  4. Orchestrator routes to ConnectAgent via RoutedRequest
  5. ConnectAgent returns RoutedResponse
  6. Orchestrator sends CompletePayment + ChatMessage to user
"""
from __future__ import annotations

import json
import sys
import os
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

# Make shared/ importable when running this file directly
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from uagents import Agent, Context, Protocol
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement,
    ChatMessage,
    EndSessionContent,
    StartSessionContent,
    TextContent,
    chat_protocol_spec,
)
from uagents_core.contrib.protocols.payment import (
    CommitPayment,
    CompletePayment,
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

from shared.config import (
    CODE_AGENT_ADDRESS,
    CONNECT_AGENT_ADDRESS,
    DISCOVER_AGENT_ADDRESS,
    ORCHESTRATOR_PORT,
    ORCHESTRATOR_SEED,
)
from shared.formatters import format_answer
from shared.llm import call_artifact_llm, classify_intent
from shared.messages import RoutedRequest, RoutedResponse
from shared.system_prompts import ANSWER_PROMPT

# ---------------------------------------------------------------------------

agent = Agent(
    name="GlanceOrchestrator",
    seed=ORCHESTRATOR_SEED,
    port=ORCHESTRATOR_PORT,
    mailbox=True,
    publish_agent_details=True,
    network="testnet",
)

chat_proto = Protocol(spec=chat_protocol_spec)
payment_proto = Protocol(spec=payment_protocol_spec, role="seller")

BOOKING_FEE = Funds(amount="0.10", currency="FET", payment_method="fet_direct")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_chat(text: str, end: bool = True) -> ChatMessage:
    content: list = [TextContent(type="text", text=text)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.utcnow(), msg_id=uuid4(), content=content)


# ---------------------------------------------------------------------------
# Chat Protocol handlers
# ---------------------------------------------------------------------------


@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id),
    )

    text = ""
    for item in msg.content:
        if isinstance(item, StartSessionContent):
            continue
        if isinstance(item, TextContent):
            text += item.text

    text = text.strip()
    if not text:
        await ctx.send(
            sender,
            _make_chat(
                "Hi! I'm **Glance** — your on-screen copilot, now on ASI:One.\n\n"
                "Try:\n"
                "• Paste buggy code and I'll fix it\n"
                "• Tell me a dish and I'll give you a recipe + delivery links\n"
                "• Ask me to find a restaurant to book (0.10 FET)"
            ),
        )
        return

    intent = await classify_intent(text)
    ctx.logger.info("Intent: %s | text: %.80s", intent, text)

    if intent == "code":
        ctx.storage.set(f"session_{sender}", sender)
        await ctx.send(
            CODE_AGENT_ADDRESS,
            RoutedRequest(text=text, session_sender=sender),
        )

    elif intent == "food":
        ctx.storage.set(f"session_{sender}", sender)
        await ctx.send(
            DISCOVER_AGENT_ADDRESS,
            RoutedRequest(text=text, session_sender=sender),
        )

    elif intent == "book":
        # Gate with payment — store pending text, request 0.10 FET
        ctx.storage.set(f"book_pending_{sender}", text)
        await ctx.send(
            sender,
            RequestPayment(
                accepted_funds=[BOOKING_FEE],
                recipient=ctx.agent.address,
                deadline_seconds=120,
                description="Restaurant booking lookup (0.10 FET)",
                reference=str(uuid4()),
            ),
        )

    else:
        # Direct answer inline
        try:
            result = await call_artifact_llm(ANSWER_PROMPT, text)
            reply = format_answer(result)
        except Exception as exc:
            ctx.logger.error("LLM error: %s", exc)
            reply = "Sorry, something went wrong. Please try again."
        await ctx.send(sender, _make_chat(reply))


@chat_proto.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


# ---------------------------------------------------------------------------
# Payment Protocol handlers (seller role)
# ---------------------------------------------------------------------------


@payment_proto.on_message(CommitPayment)
async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
    ctx.logger.info("Payment committed: txn=%s from %s", msg.transaction_id, sender)

    pending_text = ctx.storage.get(f"book_pending_{sender}")
    if not pending_text:
        ctx.logger.warning("No pending booking after payment from %s", sender)
        await ctx.send(sender, _make_chat("Payment received but no pending booking found. Please try again."))
        return

    # Mark as paid and dispatch to ConnectAgent
    ctx.storage.set(f"book_paid_{sender}", msg.transaction_id)
    ctx.storage.set(f"book_pending_{sender}", None)
    await ctx.send(
        CONNECT_AGENT_ADDRESS,
        RoutedRequest(text=pending_text, session_sender=sender),
    )


@payment_proto.on_message(RejectPayment)
async def on_reject(ctx: Context, sender: str, msg: RejectPayment):
    ctx.storage.set(f"book_pending_{sender}", None)
    await ctx.send(
        sender,
        _make_chat("No problem — I skipped the restaurant lookup. Ask me anything else!"),
    )


# ---------------------------------------------------------------------------
# Internal routing — receives responses from specialists
# ---------------------------------------------------------------------------


@agent.on_message(RoutedResponse)
async def on_specialist_response(ctx: Context, sender: str, msg: RoutedResponse):
    original_sender = msg.session_sender

    # If this came from a paid booking, finalize payment
    txn_id = ctx.storage.get(f"book_paid_{original_sender}")
    if txn_id:
        ctx.storage.set(f"book_paid_{original_sender}", None)
        await ctx.send(original_sender, CompletePayment(transaction_id=txn_id))

    await ctx.send(original_sender, _make_chat(msg.text))


# ---------------------------------------------------------------------------

agent.include(chat_proto, publish_manifest=True)
agent.include(payment_proto, publish_manifest=True)

if __name__ == "__main__":
    print(f"Orchestrator address: {agent.address}")
    agent.run()
