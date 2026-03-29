"""
Session service for Dzeck AI Agent.
DDD pattern: Application Service Layer.

Orchestrates session lifecycle:
- Create / Resume / Rollback sessions
- Persist state to MongoDB via SessionStore
- Cache hot state to Redis via CacheStore
- Provide session resume from any point
"""
import os
import json
import uuid
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from server.agent.db.session_store import SessionStore, get_session_store
from server.agent.db.cache import CacheStore, get_cache_store

logger = logging.getLogger(__name__)


class SessionService:
    """
    High-level session management service.
    
    Provides:
    - Session creation with unique IDs
    - State persistence (MongoDB) and caching (Redis)
    - Session resume from saved state
    - Step-level rollback
    - Session listing and history
    """

    def __init__(
        self,
        session_store: Optional[SessionStore] = None,
        cache_store: Optional[CacheStore] = None,
    ) -> None:
        self._session_store = session_store
        self._cache_store = cache_store

    async def _get_session_store(self) -> SessionStore:
        if self._session_store is None:
            self._session_store = await get_session_store()
        return self._session_store

    async def _get_cache_store(self) -> CacheStore:
        if self._cache_store is None:
            self._cache_store = await get_cache_store()
        return self._cache_store

    def generate_session_id(self) -> str:
        """Generate a unique session ID."""
        return str(uuid.uuid4())

    async def create_session(
        self,
        user_message: str,
        session_id: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        Create a new agent session.
        Returns the session_id.
        """
        sid = session_id or self.generate_session_id()
        store = await self._get_session_store()
        cache = await self._get_cache_store()

        session_doc = await store.create_session(
            session_id=sid,
            user_message=user_message,
            metadata=metadata or {},
        )

        await cache.cache_session_state(sid, {
            "status": "running",
            "user_message": user_message,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        logger.info("[SessionService] Created session: %s", sid)
        return sid

    async def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Get session state. Checks Redis cache first, then MongoDB.
        """
        cache = await self._get_cache_store()
        cached = await cache.get_session_state(session_id)
        if cached:
            return cached

        store = await self._get_session_store()
        session = await store.get_session(session_id)

        if session:
            await cache.cache_session_state(session_id, session)

        return session

    async def list_sessions(
        self,
        limit: int = 20,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List recent sessions."""
        store = await self._get_session_store()
        return await store.list_sessions(limit=limit, status=status)

    async def save_plan_snapshot(
        self,
        session_id: str,
        plan: Dict[str, Any],
    ) -> None:
        """Save the current plan to both MongoDB and Redis cache.
        Raises RuntimeError if MongoDB is unavailable (explicit fail-fast per requirement #6)."""
        store = await self._get_session_store()
        cache = await self._get_cache_store()

        await store.update_session(session_id, {"plan": plan})
        await cache.cache_plan(session_id, plan)
        await store.save_event(session_id, "plan_snapshot", {"plan": plan})

    async def save_step_completed(
        self,
        session_id: str,
        step: Dict[str, Any],
    ) -> None:
        """Record a completed step.
        Raises RuntimeError if MongoDB is unavailable (explicit fail-fast per requirement #6)."""
        store = await self._get_session_store()
        await store.save_event(session_id, "step_completed", {"step": step})

        session = await store.get_session(session_id)
        if session:
            steps = session.get("steps_completed", [])
            steps.append(step)
            await store.update_session(session_id, {"steps_completed": steps})

    async def save_memory(
        self,
        session_id: str,
        messages: List[Dict[str, Any]],
    ) -> None:
        """Save agent working memory (message history)."""
        cache = await self._get_cache_store()
        await cache.cache_memory(session_id, messages)

    async def load_memory(
        self,
        session_id: str,
    ) -> List[Dict[str, Any]]:
        """Load agent working memory from cache."""
        cache = await self._get_cache_store()
        memory = await cache.get_memory(session_id)
        return memory or []

    async def save_chat_history(
        self,
        session_id: str,
        history: List[Dict[str, Any]],
    ) -> None:
        """Save full conversation history (user+assistant turns) — persists across messages."""
        cache = await self._get_cache_store()
        await cache.cache_chat_history(session_id, history)
        store = await self._get_session_store()
        await store.update_session(session_id, {"chat_history": history})

    async def load_chat_history(
        self,
        session_id: str,
    ) -> List[Dict[str, Any]]:
        """Load conversation history — checks Redis first, then MongoDB."""
        cache = await self._get_cache_store()
        history = await cache.get_chat_history(session_id)
        if history is not None:
            return history
        store = await self._get_session_store()
        session = await store.get_session(session_id)
        if session:
            return session.get("chat_history", [])
        return []

    async def resume_session(
        self,
        session_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Resume a session from its saved state.
        Returns the session with plan and steps for the agent to continue.
        """
        store = await self._get_session_store()
        session = await store.get_session(session_id)

        if not session:
            logger.warning("[SessionService] Session not found: %s", session_id)
            return None

        if session.get("status") == "completed":
            logger.info("[SessionService] Session already completed: %s", session_id)
            return session

        await store.update_session(session_id, {"status": "resuming"})
        await store.save_event(session_id, "resume", {
            "resumed_at": datetime.now(timezone.utc).isoformat(),
        })

        logger.info("[SessionService] Resuming session: %s", session_id)
        return session

    async def rollback_session(
        self,
        session_id: str,
        to_step_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Rollback a session to a previous step.
        Clears cached state and resets to the rollback point.
        """
        store = await self._get_session_store()
        cache = await self._get_cache_store()

        result = await store.rollback_session(session_id, to_step_id)

        await cache.invalidate_session(session_id)

        logger.info("[SessionService] Rolled back session %s to step %s",
                    session_id, to_step_id or "beginning")
        return result

    async def complete_session(
        self,
        session_id: str,
        result: Optional[str] = None,
        success: bool = True,
    ) -> None:
        """Mark a session as completed."""
        store = await self._get_session_store()
        cache = await self._get_cache_store()

        await store.complete_session(session_id, result=result, success=success)
        await cache.invalidate_session(session_id)
        await store.save_event(session_id, "completed" if success else "failed", {
            "result": result,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })

    async def save_waiting_state(
        self,
        session_id: str,
        plan: Dict[str, Any],
        pending_steps: List[Dict[str, Any]],
        user_message: str,
        chat_history: Optional[List[Dict[str, Any]]] = None,
        clarification_mode: bool = False,
    ) -> None:
        """Save waiting_for_user state to Redis (primary) and MongoDB (fallback).
        No local file fallback — requires Redis or MongoDB."""
        waiting_state: Dict[str, Any] = {
            "waiting_for_user": True,
            "plan": plan,
            "pending_steps": pending_steps,
            "user_message": user_message,
            "chat_history": chat_history or [],
        }
        if clarification_mode:
            waiting_state["clarification_mode"] = True
        try:
            cache = await self._get_cache_store()
            store = await self._get_session_store()
            await cache.cache_session_state(session_id, waiting_state)
            await store.update_session(session_id, {"waiting_state": waiting_state, "status": "waiting_for_user"})
            logger.info("[SessionService] Saved waiting state for session: %s", session_id)
        except Exception as e:
            logger.error("[SessionService] Failed to save waiting state for %s: %s", session_id, e)

    async def load_waiting_state(
        self,
        session_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Load waiting_for_user state from Redis (primary) or MongoDB (fallback).
        Returns None if not waiting or if neither Redis nor MongoDB is available."""
        try:
            cache = await self._get_cache_store()
            cached = await cache.get_session_state(session_id)
            if cached and cached.get("waiting_for_user"):
                return cached
            store = await self._get_session_store()
            session = await store.get_session(session_id)
            if session:
                ws = session.get("waiting_state")
                if ws and ws.get("waiting_for_user"):
                    return ws
        except Exception as e:
            logger.warning("[SessionService] Failed to load waiting state for %s: %s", session_id, e)
        return None

    async def clear_waiting_state(
        self,
        session_id: str,
    ) -> None:
        """Clear the waiting_for_user flag from Redis and MongoDB after user has replied."""
        try:
            store = await self._get_session_store()
            await store.update_session(session_id, {"waiting_state": None, "status": "running"})
            cache = await self._get_cache_store()
            await cache.invalidate_session(session_id)
            logger.info("[SessionService] Cleared waiting state for session: %s", session_id)
        except Exception as e:
            logger.warning("[SessionService] Failed to clear waiting state for %s: %s", session_id, e)

    async def get_session_events(
        self,
        session_id: str,
        event_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get the event log for a session (useful for replay/debugging)."""
        store = await self._get_session_store()
        return await store.get_events(session_id, event_type)


_session_service: Optional[SessionService] = None


async def get_session_service() -> SessionService:
    """Get or create the global session service singleton."""
    global _session_service
    if _session_service is None:
        _session_service = SessionService()
    return _session_service
