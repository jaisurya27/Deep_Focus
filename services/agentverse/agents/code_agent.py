"""CodeAgent — fixes bugs and explains code.

Handles:
  - RoutedRequest from Orchestrator (internal multi-agent path)
  - ChatMessage directly from ASI:One (standalone path)

Artifact: fix_code
"""
from __future__ import annotations

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

from shared.config import CODE_AGENT_PORT, CODE_AGENT_SEED, ORCHESTRATOR_ADDRESS
from shared.formatters import format_fix_code
from shared.llm import call_artifact_llm
from shared.messages import RoutedRequest, RoutedResponse
from shared.system_prompts import FIX_CODE_PROMPT

# ---------------------------------------------------------------------------

agent = Agent(
    name="GlanceCodeAgent",
    seed=CODE_AGENT_SEED,
    port=CODE_AGENT_PORT,
    endpoint=[f"http://127.0.0.1:{CODE_AGENT_PORT}/submit"],
    mailbox=True,
    publish_agent_details=True,
    network="testnet",
)

chat_proto = Protocol(spec=chat_protocol_spec)


def _make_chat(text: str) -> ChatMessage:
    return ChatMessage(
        timestamp=datetime.utcnow(),
        msg_id=uuid4(),
        content=[TextContent(type="text", text=text), EndSessionContent(type="end-session")],
    )


async def _run_fix_code(text: str) -> str:
    try:
        data = await call_artifact_llm(FIX_CODE_PROMPT, text)
        return format_fix_code(data)
    except Exception as exc:
        return f"Sorry, the code analysis failed: {exc}"


# ---------------------------------------------------------------------------
# Internal routing — called by Orchestrator
# ---------------------------------------------------------------------------


@agent.on_message(RoutedRequest)
async def on_routed(ctx: Context, sender: str, msg: RoutedRequest):
    ctx.logger.info("RoutedRequest from %s | %.60s", sender, msg.text)
    result = await _run_fix_code(msg.text)
    await ctx.send(
        ORCHESTRATOR_ADDRESS,
        RoutedResponse(text=result, session_sender=msg.session_sender),
    )


# ---------------------------------------------------------------------------
# Direct ASI:One Chat Protocol path
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
        await ctx.send(sender, _make_chat("Paste your buggy code and I'll diagnose and fix it."))
        return
    result = await _run_fix_code(text)
    await ctx.send(sender, _make_chat(result))


@chat_proto.on_message(ChatAcknowledgement)
async def on_ack(ctx: Context, sender: str, msg: ChatAcknowledgement):
    pass


# ---------------------------------------------------------------------------

agent.include(chat_proto, publish_manifest=True)

if __name__ == "__main__":
    print(f"CodeAgent address: {agent.address}")
    agent.run()
