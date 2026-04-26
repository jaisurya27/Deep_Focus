"""Session CRUD routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.store.memory import store

router = APIRouter(prefix="/session", tags=["session"])


@router.post("")
def create_session() -> dict:
    session = store.create()
    return {"session_id": session.id, "created_at": session.created_at}


@router.get("")
def list_sessions(q: str | None = Query(default=None)) -> dict:
    """List session summaries, optionally filtered by `q` substring."""
    return {"sessions": store.list_summaries(q)}


@router.get("/{session_id}")
def get_session(session_id: str) -> dict:
    session = store.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session.to_dict()


@router.delete("/{session_id}")
def delete_session(session_id: str) -> dict:
    ok = store.delete(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@router.delete("")
def delete_all_sessions() -> dict:
    removed = store.delete_all()
    return {"ok": True, "removed": removed}
