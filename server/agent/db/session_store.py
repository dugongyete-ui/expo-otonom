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

    def __init__(self, uri: Optional[str] = None, db_name: str = "") -> None:
        self._uri = uri or os.environ.get("MONGODB_URI", "")
        self._db_name = db_name or os.environ.get("MONGO_DB_NAME", "manus")
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
            raise RuntimeError(
                "[SessionStore] motor package is not installed. MongoDB persistence is required. "
                "Install with: pip install motor"
            )
        if not self._uri:
            raise RuntimeError(
                "[SessionStore] MONGODB_URI is not set. MongoDB persistence is required. "
                "Set MONGODB_URI in your environment variables."
            )
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
        except RuntimeError:
            raise
        except Exception as e:
            self._connected = False
            raise RuntimeError(
                f"[SessionStore] MongoDB connection failed: {e}. "
                "Check MONGODB_URI and ensure MongoDB is accessible."
            ) from e

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
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create or upsert a session document (idempotent).
        
        user_id is written in $set (not $setOnInsert) to guarantee ownership is always
        stamped even when Python creates the document before the TS write lands.
        """
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
        if user_id:
            doc["user_id"] = user_id
        if self._connected:
            try:
                set_fields: Dict[str, Any] = {
                    "status": "running",
                    "updated_at": now,
                }
                if user_id:
                    set_fields["user_id"] = user_id
                await self._sessions.update_one(
                    {"session_id": session_id},
                    {
                        "$setOnInsert": {
                            "session_id": session_id,
                            "created_at": now,
                            "user_message": user_message,
                            "metadata": metadata or {},
                        },
                        "$set": set_fields,
                    },
                    upsert=True,
                )
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
            raise RuntimeError(
                f"[SessionStore] Cannot save event for session {session_id}: MongoDB not connected."
            )
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
            raise

    async def add_event(
        self,
        session_id: str,
        event_type: str,
        data: Dict[str, Any],
    ) -> None:
        """Alias for save_event — required by agent event pipeline."""
        await self.save_event(session_id, event_type, data)

    async def add_step(
        self,
        session_id: str,
        step: Dict[str, Any],
    ) -> None:
        """Persist a new plan step to MongoDB session_events for resume/rollback."""
        if not self._connected:
            raise RuntimeError(
                f"[SessionStore] Cannot add step for session {session_id}: MongoDB not connected."
            )
        try:
            doc = {
                "session_id": session_id,
                "event_type": "step_added",
                "timestamp": datetime.now(timezone.utc),
                "data": step,
            }
            await self._events.insert_one(doc)
            # Also update steps in sessions collection
            await self._sessions.update_one(
                {"session_id": session_id},
                {"$push": {"steps_completed": step}, "$set": {"updated_at": datetime.now(timezone.utc)}},
                upsert=False,
            )
        except Exception as e:
            logger.error("[SessionStore] add_step error: %s", e)
            raise

    async def update_step(
        self,
        session_id: str,
        step_id: str,
        updates: Dict[str, Any],
    ) -> None:
        """Update an existing plan step's fields in MongoDB."""
        if not self._connected:
            raise RuntimeError(
                f"[SessionStore] Cannot update step {step_id} for session {session_id}: MongoDB not connected."
            )
        try:
            now = datetime.now(timezone.utc)
            updates["updated_at"] = now
            await self._events.insert_one({
                "session_id": session_id,
                "event_type": "step_updated",
                "timestamp": now,
                "data": {"step_id": step_id, **updates},
            })
            # Update matching step in steps_completed array
            set_fields: Dict[str, Any] = {f"steps_completed.$.{k}": v for k, v in updates.items()}
            set_fields["updated_at"] = now
            await self._sessions.update_one(
                {"session_id": session_id, "steps_completed.id": step_id},
                {"$set": set_fields},
                upsert=False,
            )
        except Exception as e:
            logger.error("[SessionStore] update_step error: %s", e)
            raise

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

    async def delete_session(
        self,
        session_id: str,
        user_id: Optional[str] = None,
    ) -> bool:
        """Delete a session and its events from MongoDB.

        If user_id is provided, enforces ownership (IDOR prevention) — only
        deletes if the session's user_id matches.  Returns True on success.
        """
        if not self._connected:
            return False
        try:
            query: Dict[str, Any] = {"session_id": session_id}
            if user_id:
                query["user_id"] = user_id
            result = await self._sessions.delete_one(query)
            if result.deleted_count == 0:
                logger.warning(
                    "[SessionStore] delete_session: no document matched (session=%s user=%s)",
                    session_id, user_id,
                )
                return False
            # Also purge related events (best-effort)
            try:
                await self._events.delete_many({"session_id": session_id})
            except Exception as ev_err:
                logger.warning("[SessionStore] delete_session event purge failed: %s", ev_err)
            logger.info("[SessionStore] Deleted session %s", session_id)
            return True
        except Exception as e:
            logger.error("[SessionStore] delete_session error: %s", e)
            return False

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
