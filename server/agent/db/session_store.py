"""
MongoDB session persistence for Dzeck AI Agent.
DDD pattern: Repository / Infrastructure Layer.

Stores full agent session state to MongoDB Atlas:
- Session metadata (id, user, created_at, status)
- Plan & steps snapshots for resume/rollback
- Message history
- Tool execution logs
"""
import os
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_motor_available = False
AsyncIOMotorClient = None
AsyncIOMotorDatabase = None
AsyncIOMotorCollection = None

try:
    from motor.motor_asyncio import AsyncIOMotorClient as _Client
    AsyncIOMotorClient = _Client
    _motor_available = True
except ImportError:
    logger.warning("[SessionStore] motor not installed. MongoDB persistence disabled.")


class SessionStore:
    """
    MongoDB-backed session store for agent sessions.
    Implements Repository pattern from DDD.
    
    Collections:
      - sessions: full session documents
      - session_events: event log per session (rollback support)
    """

    def __init__(self, uri: Optional[str] = None, db_name: str = "manus") -> None:
        self._uri = uri or os.environ.get("MONGODB_URI", "")
        self._db_name = db_name
        self._client: Any = None
        self._db: Any = None
        self._sessions: Any = None
        self._events: Any = None
        self._connected = False

    async def connect(self) -> bool:
        """Connect to MongoDB. Returns True on success. Only attempts once."""
        if hasattr(self, '_connect_attempted') and self._connect_attempted:
            return self._connected
        self._connect_attempted = True

        if not _motor_available:
            logger.warning("[SessionStore] motor not available, skipping MongoDB connect.")
            return False
        if not self._uri:
            logger.warning("[SessionStore] MONGODB_URI not set, sessions will be in-memory only.")
            return False
        try:
            self._client = AsyncIOMotorClient(
                self._uri,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
            )
            self._db = self._client[self._db_name]
            self._sessions = self._db["sessions"]
            self._events = self._db["session_events"]

            await self._client.admin.command("ping")
            await self._ensure_indexes()
            self._connected = True
            logger.info("[SessionStore] Connected to MongoDB.")
            return True
        except Exception as e:
            logger.warning("[SessionStore] MongoDB unavailable (sessions will be in-memory): %s", e)
            self._connected = False
            return False

    async def _ensure_indexes(self) -> None:
        """Create indexes for efficient querying."""
        try:
            await self._sessions.create_index("created_at")
            await self._sessions.create_index("status")
            await self._events.create_index([("session_id", 1), ("timestamp", 1)])
            try:
                await self._sessions.create_index("session_id", unique=True)
            except Exception:
                pass
        except Exception as e:
            logger.warning("[SessionStore] Index creation warning: %s", e)

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def create_session(
        self,
        session_id: str,
        user_message: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create a new agent session document."""
        now = datetime.now(timezone.utc)
        doc = {
            "session_id": session_id,
            "user_message": user_message,
            "status": "running",
            "created_at": now,
            "updated_at": now,
            "plan": None,
            "steps_completed": [],
            "messages": [],
            "result": None,
            "error": None,
            "metadata": metadata or {},
        }
        if self._connected:
            try:
                await self._sessions.insert_one(doc)
            except Exception as e:
                logger.error("[SessionStore] create_session error: %s", e)
        doc.pop("_id", None)
        return doc

    async def update_session(
        self,
        session_id: str,
        updates: Dict[str, Any],
    ) -> None:
        """Update session fields."""
        if not self._connected:
            return
        try:
            updates["updated_at"] = datetime.now(timezone.utc)
            await self._sessions.update_one(
                {"session_id": session_id},
                {"$set": updates},
            )
        except Exception as e:
            logger.error("[SessionStore] update_session error: %s", e)

    async def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get a session by ID."""
        if not self._connected:
            return None
        try:
            doc = await self._sessions.find_one({"session_id": session_id})
            if doc:
                doc.pop("_id", None)
            return doc
        except Exception as e:
            logger.error("[SessionStore] get_session error: %s", e)
            return None

    async def list_sessions(
        self,
        limit: int = 20,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """List recent sessions, optionally filtered by status."""
        if not self._connected:
            return []
        try:
            query: Dict[str, Any] = {}
            if status:
                query["status"] = status
            cursor = self._sessions.find(
                query,
                {"_id": 0},
            ).sort("created_at", -1).limit(limit)
            return await cursor.to_list(length=limit)
        except Exception as e:
            logger.error("[SessionStore] list_sessions error: %s", e)
            return []

    async def save_event(
        self,
        session_id: str,
        event_type: str,
        data: Dict[str, Any],
    ) -> None:
        """Append a session event (for rollback support)."""
        if not self._connected:
            return
        try:
            event = {
                "session_id": session_id,
                "event_type": event_type,
                "timestamp": datetime.now(timezone.utc),
                "data": data,
            }
            await self._events.insert_one(event)
        except Exception as e:
            logger.error("[SessionStore] save_event error: %s", e)

    async def get_events(
        self,
        session_id: str,
        event_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get all events for a session (for resume/rollback)."""
        if not self._connected:
            return []
        try:
            query: Dict[str, Any] = {"session_id": session_id}
            if event_type:
                query["event_type"] = event_type
            cursor = self._events.find(query, {"_id": 0}).sort("timestamp", 1)
            return await cursor.to_list(length=1000)
        except Exception as e:
            logger.error("[SessionStore] get_events error: %s", e)
            return []

    async def rollback_session(
        self,
        session_id: str,
        to_step_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Rollback a session to a previous step.
        If to_step_id is None, rolls back to before any steps were executed.
        Returns the restored session state.
        """
        session = await self.get_session(session_id)
        if not session:
            return None

        steps_completed = session.get("steps_completed", [])

        if to_step_id is None:
            steps_to_keep = []
        else:
            steps_to_keep = []
            for step in steps_completed:
                steps_to_keep.append(step)
                if step.get("id") == to_step_id:
                    break

        await self.update_session(session_id, {
            "steps_completed": steps_to_keep,
            "status": "rolling_back",
        })

        await self.save_event(session_id, "rollback", {
            "to_step_id": to_step_id,
            "steps_kept": len(steps_to_keep),
        })

        return await self.get_session(session_id)

    async def complete_session(
        self,
        session_id: str,
        result: Optional[str] = None,
        success: bool = True,
    ) -> None:
        """Mark a session as completed."""
        await self.update_session(session_id, {
            "status": "completed" if success else "failed",
            "result": result,
        })

    async def close(self) -> None:
        """Close the MongoDB connection."""
        if self._client:
            self._client.close()
            self._connected = False


_session_store: Optional[SessionStore] = None


async def get_session_store() -> SessionStore:
    """Get or create the global session store singleton."""
    global _session_store
    if _session_store is None:
        _session_store = SessionStore()
        await _session_store.connect()
    return _session_store
