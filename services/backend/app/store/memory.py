"""Tiny in-memory session store.

Phase 1 keeps sessions in a process-local dict. Later phases can swap in a
SQLite-backed store behind the same interface without touching the routes.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from threading import RLock
from typing import Iterable


@dataclass
class Exchange:
    role: str  # "user" | "assistant" | "system"
    content: str
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    # Optional provenance: "just-ask" | "selection" | "region".
    source: str | None = None
    # For selection mode: the verbatim text the user highlighted.
    source_text: str | None = None
    # For region mode: a relative path (under userData) to the captured PNG.
    # We keep paths, not base64, so sessions stay cheap to serialize.
    source_image_path: str | None = None
    # Preset applied to this turn, if any.
    preset: str | None = None


@dataclass
class Session:
    id: str
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    messages: list[Exchange] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "created_at": self.created_at,
            "messages": [dict(m.__dict__) for m in self.messages],
        }


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, Session] = {}
        self._lock = RLock()

    def create(self) -> Session:
        with self._lock:
            session = Session(id=str(uuid.uuid4()))
            self._sessions[session.id] = session
            return session

    def get(self, session_id: str) -> Session | None:
        with self._lock:
            return self._sessions.get(session_id)

    def ensure(self, session_id: str | None) -> Session:
        """Return an existing session by id, or create one if missing."""
        if session_id:
            with self._lock:
                existing = self._sessions.get(session_id)
                if existing is not None:
                    return existing
        return self.create()

    def append(self, session_id: str, exchange: Exchange) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            session.messages.append(exchange)

    def append_many(self, session_id: str, exchanges: Iterable[Exchange]) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise KeyError(session_id)
            session.messages.extend(exchanges)

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def delete_all(self) -> int:
        with self._lock:
            n = len(self._sessions)
            self._sessions.clear()
            return n

    def list(self) -> list[Session]:
        with self._lock:
            return list(self._sessions.values())

    def list_summaries(self, query: str | None = None) -> list[dict]:
        """Return session summaries ordered by most-recently-touched first.

        Each summary includes a snippet from the first user turn, the message
        count, and the last-updated timestamp — enough to render a history
        list without fetching every exchange.
        """
        q = (query or "").strip().lower()
        with self._lock:
            out: list[tuple[str, dict]] = []
            for session in self._sessions.values():
                last_ts = session.messages[-1].created_at if session.messages else session.created_at
                first_user = next(
                    (m for m in session.messages if m.role == "user"),
                    None,
                )
                snippet = (first_user.content if first_user else "").strip().replace("\n", " ")
                if q and q not in snippet.lower() and not any(
                    q in (m.content or "").lower() for m in session.messages
                ):
                    continue
                out.append(
                    (
                        last_ts,
                        {
                            "id": session.id,
                            "created_at": session.created_at,
                            "updated_at": last_ts,
                            "snippet": snippet[:240] if snippet else "(empty session)",
                            "message_count": len(session.messages),
                        },
                    )
                )
            out.sort(key=lambda pair: pair[0], reverse=True)
            return [item for _, item in out]

    def purge_older_than(self, days: int) -> int:
        """Drop sessions whose last activity is older than `days` days.

        Returns how many sessions were removed.
        """
        if days <= 0:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        removed = 0
        with self._lock:
            for sid in list(self._sessions.keys()):
                session = self._sessions[sid]
                last = session.messages[-1].created_at if session.messages else session.created_at
                try:
                    ts = datetime.fromisoformat(last)
                except ValueError:
                    continue
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                if ts < cutoff:
                    del self._sessions[sid]
                    removed += 1
        return removed


store = SessionStore()
