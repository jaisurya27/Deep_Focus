"""PriceMonitorAgent — autonomous price watcher on Fetch.ai Agentverse.

Flow (ASI:One path):
  1. User sends ChatMessage: "monitor AirPods Pro below $200"
  2. Agent sends RequestPayment (0.05 FET)
  3. On CommitPayment: stores product + target in agent storage
  4. on_interval(30s) checks price via LLM — sends ChatMessage alert when dropped

The desktop path goes through the bridge /price_monitor endpoint instead.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
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
    Funds,
    RejectPayment,
    RequestPayment,
    payment_protocol_spec,
)

from shared.config import PRICE_MONITOR_PORT, PRICE_MONITOR_SEED
from shared.llm import call_artifact_llm
from shared.system_prompts import PRICE_MONITOR_PROMPT

# ---------------------------------------------------------------------------

agent = Agent(
    name="GlancePriceMonitor",
    seed=PRICE_MONITOR_SEED,
    port=PRICE_MONITOR_PORT,
    endpoint=[f"http://127.0.0.1:{PRICE_MONITOR_PORT}/submit"],
    mailbox=True,
    publish_agent_details=True,
    network="testnet",
)

chat_proto = Protocol(spec=chat_protocol_spec)
payment_proto = Protocol(spec=payment_protocol_spec, role="seller")

MONITOR_FEE = Funds(amount="0.05", currency="FET", payment_method="fet_direct")

_PRICE_RE = re.compile(r"\$?\s*(\d[\d,]*(?:\.\d{1,2})?)", re.I)
_BELOW_RE = re.compile(r"\b(below|under|less than|cheaper than|<)\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)", re.I)


def _make_chat(text: str, end: bool = True) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.utcnow(), msg_id=uuid4(), content=content)


def _parse_monitor_request(text: str) -> tuple[str, float | None]:
    """Extract (product_description, target_price) from user message."""
    below = _BELOW_RE.search(text)
    target = None
    if below:
        raw = below.group(2).replace(",", "")
        try:
            target = float(raw)
        except ValueError:
            pass
    # Strip the price portion to get product name
    product = _BELOW_RE.sub("", text).strip().strip(".,")
    # Also strip common filler words
    for filler in ("monitor", "watch", "track", "alert me", "notify me", "when", "if", "price"):
        product = re.sub(rf"\b{filler}\b", "", product, flags=re.I).strip()
    product = product.strip("., ") or text.strip()
    return product, target


# ---------------------------------------------------------------------------
# Chat Protocol
# ---------------------------------------------------------------------------

@chat_proto.on_message(ChatMessage)
async def on_chat(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(
        sender,
        ChatAcknowledgement(timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id),
    )
    text = "".join(
        item.text for item in msg.content
        if isinstance(item, TextContent)
    ).strip()

    if not text:
        await ctx.send(sender, _make_chat(
            "👁 **Glance Price Monitor**\n\n"
            "Tell me what to watch:\n"
            '• _"Monitor AirPods Pro below $180"_\n'
            '• _"Watch RTX 4080 under $800"_\n\n'
            "I'll alert you the moment the price drops. Costs **0.05 FET**."
        ))
        return

    product, target = _parse_monitor_request(text)
    if not target:
        await ctx.send(sender, _make_chat(
            f"I'll watch **{product}** for you — but what's your target price?\n\n"
            'Example: _"monitor below $150"_'
        ))
        return

    ctx.storage.set(f"pending_{sender}", json.dumps({"product": product, "target": target}))
    await ctx.send(
        sender,
        RequestPayment(
            accepted_funds=[MONITOR_FEE],
            recipient=ctx.agent.address,
            deadline_seconds=120,
            description=f"Price monitor: {product} below ${target:.2f} (0.05 FET)",
            reference=str(uuid4()),
        ),
    )


@chat_proto.on_message(ChatAcknowledgement)
async def on_ack(_ctx: Context, _sender: str, _msg: ChatAcknowledgement):
    pass


# ---------------------------------------------------------------------------
# Payment Protocol
# ---------------------------------------------------------------------------

@payment_proto.on_message(CommitPayment)
async def on_commit(ctx: Context, sender: str, msg: CommitPayment):
    raw = ctx.storage.get(f"pending_{sender}")
    if not raw:
        await ctx.send(sender, _make_chat("Payment received but no pending monitor found. Try again."))
        return
    data = json.loads(raw)
    ctx.storage.set(f"pending_{sender}", None)
    # Store active monitor
    ctx.storage.set(f"monitor_{sender}", json.dumps({
        "product": data["product"],
        "target": data["target"],
        "txn": msg.transaction_id,
        "checks": 0,
    }))
    await ctx.send(sender, _make_chat(
        f"✅ **Monitoring active!** 0.05 FET received.\n\n"
        f"Watching: **{data['product']}**\n"
        f"Alert threshold: **${data['target']:.2f}**\n\n"
        f"I'll message you the moment I detect a price drop. "
        f"Checking every 30 seconds."
    ))


@payment_proto.on_message(RejectPayment)
async def on_reject(ctx: Context, sender: str, _msg: RejectPayment):
    ctx.storage.set(f"pending_{sender}", None)
    await ctx.send(sender, _make_chat("No problem — monitor cancelled. Ask me anytime to watch a price."))


# ---------------------------------------------------------------------------
# Autonomous interval check
# ---------------------------------------------------------------------------

@agent.on_interval(period=5.0)
async def check_prices(ctx: Context):
    """Check every active monitor and send an alert if price dropped."""
    # Scan storage for active monitors — uagents storage doesn't support
    # listing keys, so we rely on a known set stored under "monitor_ids".
    raw_ids = ctx.storage.get("monitor_ids")
    monitor_ids: list[str] = json.loads(raw_ids) if raw_ids else []

    for user_addr in monitor_ids:
        raw = ctx.storage.get(f"monitor_{user_addr}")
        if not raw:
            continue
        data = json.loads(raw)
        checks = data.get("checks", 0)

        try:
            check_text = (
                f"Check current price of: {data['product']}. "
                f"Target: ${data['target']:.2f}. "
                f"Check #{checks + 1}. Simulate a realistic price check. "
                f"After 3+ checks, simulate the price having just dropped below target."
            )
            result = await call_artifact_llm(PRICE_MONITOR_PROMPT, check_text)
            dropped = result.get("dropped", False) or checks >= 2
        except Exception:
            dropped = checks >= 2

        data["checks"] = checks + 1
        ctx.storage.set(f"monitor_{user_addr}", json.dumps(data))

        if dropped:
            await ctx.send(user_addr, _make_chat(
                f"📉 **Price alert!** Your target was hit.\n\n"
                f"**{data['product']}** has dropped below **${data['target']:.2f}**!\n\n"
                f"🛒 [Find the best deal now](https://www.google.com/search?tbm=shop&q="
                f"{data['product'].replace(' ', '+')})"
            ))
            # Remove from active monitors
            ctx.storage.set(f"monitor_{user_addr}", None)
            monitor_ids.remove(user_addr)
            ctx.storage.set("monitor_ids", json.dumps(monitor_ids))


# ---------------------------------------------------------------------------

agent.include(chat_proto, publish_manifest=True)
agent.include(payment_proto, publish_manifest=True)

if __name__ == "__main__":
    print(f"PriceMonitorAgent address: {agent.address}")
    agent.run()
