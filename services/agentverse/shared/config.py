"""Deterministic agent seeds, ports, and address derivation.

All seeds are fixed so addresses are stable across restarts. Import
`*_ADDRESS` constants anywhere you need to send to a specific agent.
"""
from __future__ import annotations

ORCHESTRATOR_SEED = "glance-orchestrator-lahacks-2026"
CODE_AGENT_SEED = "glance-code-agent-lahacks-2026"
DISCOVER_AGENT_SEED = "glance-discover-agent-lahacks-2026"
CONNECT_AGENT_SEED = "glance-connect-agent-lahacks-2026"

BRIDGE_PORT = 8020
ORCHESTRATOR_PORT = 8010
CODE_AGENT_PORT = 8011
DISCOVER_AGENT_PORT = 8012
CONNECT_AGENT_PORT = 8013
PRICE_MONITOR_PORT = 8017

PRICE_MONITOR_SEED = "glance-price-monitor-lahacks-2026"


def seed_to_address(seed: str) -> str:
    """Derive agent address from seed without starting an agent."""
    try:
        from uagents.crypto import Identity
        return Identity.from_seed(seed, 0).address
    except Exception:
        # Fallback: instantiate Agent (safe — .run() not called)
        from uagents import Agent  # type: ignore
        return Agent(seed=seed).address


CODE_AGENT_ADDRESS = seed_to_address(CODE_AGENT_SEED)
DISCOVER_AGENT_ADDRESS = seed_to_address(DISCOVER_AGENT_SEED)
CONNECT_AGENT_ADDRESS = seed_to_address(CONNECT_AGENT_SEED)
ORCHESTRATOR_ADDRESS = seed_to_address(ORCHESTRATOR_SEED)
