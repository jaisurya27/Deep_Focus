"""Launch all four Glance Agentverse agents as parallel subprocesses.

Usage:
    cd services/agentverse
    pip install -r requirements.txt
    cp .env.example .env  # fill in OPENAI_API_KEY (or XAI_API_KEY)
    python run_all.py

Each agent prints its Agentverse address on startup. Copy those into
agentverse.ai to set up mailboxes and register for ASI:One discovery.

Ctrl+C stops all agents cleanly.
"""
from __future__ import annotations

import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent

AGENTS = [
    # Bridge first — backend delegates to it immediately on startup
    ("Bridge",             HERE / "bridge.py"),
    ("ConnectAgent",       HERE / "agents" / "connect_agent.py"),
    ("DiscoverAgent",      HERE / "agents" / "discover_agent.py"),
    ("CodeAgent",          HERE / "agents" / "code_agent.py"),
    ("PriceMonitorAgent",  HERE / "agents" / "price_monitor_agent.py"),
    # Orchestrator last — specialists must be up first
    ("Orchestrator",       HERE / "agents" / "orchestrator.py"),
]

STARTUP_DELAY = 2.0  # seconds between agent launches


def main() -> None:
    procs: list[subprocess.Popen] = []

    def shutdown(sig=None, frame=None):
        print("\nShutting down all agents…")
        for p in procs:
            p.terminate()
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    for name, path in AGENTS:
        print(f"Starting {name} …")
        p = subprocess.Popen(
            [sys.executable, str(path)],
            cwd=str(HERE),
            env={**__import__("os").environ},
        )
        procs.append(p)
        time.sleep(STARTUP_DELAY)

    print("\nAll agents running. Press Ctrl+C to stop.\n")

    # Monitor — restart any agent that dies unexpectedly
    while True:
        for i, (name, path) in enumerate(AGENTS):
            p = procs[i]
            if p.poll() is not None:
                print(f"[!] {name} exited (code {p.returncode}) — restarting …")
                procs[i] = subprocess.Popen(
                    [sys.executable, str(path)],
                    cwd=str(HERE),
                    env={**__import__("os").environ},
                )
        time.sleep(5)


if __name__ == "__main__":
    main()
