"""
Agent Cross-Session Memory Service for Dzeck AI Agent.
Stores and retrieves important facts, user preferences, and learnings
across sessions using MongoDB collection `agent_memory`.

Document structure:
  {
    user_id: str,
    session_id: str,
    content: str,          # The memory fact/insight
    tags: List[str],       # Categorization tags
    importance: int,       # 1-5 scale
    created_at: datetime,
    updated_at: datetime,
  }
"""
import os
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_COLLECTION_NAME = "agent_memory"
_MAX_MEMORIES_PER_USER = 100
_MAX_MEMORIES_IN_PROMPT = 10


async def _get_col() -> Optional[Any]:
    """Get MongoDB collection, returns None if unavailable."""
    try:
        from server.agent.db.session_store import get_session_store
        store = await get_session_store()
        if store and hasattr(store, "_db") and store._db:
            return store._db[_COLLECTION_NAME]
    except Exception:
        pass
    try:
        import sys
        sys.path.insert(0, os.getcwd())
        from server.db.mongo import getCollection  # type: ignore
        col = await getCollection(_COLLECTION_NAME)
        return col
    except Exception:
        pass
    return None


async def save_memory(
    content: str,
    session_id: str = "",
    user_id: str = "auto-user",
    tags: Optional[List[str]] = None,
    importance: int = 3,
) -> bool:
    """Save an agent memory fact to MongoDB.
    
    Args:
        content: The memory content to save (fact, insight, preference)
        session_id: Source session ID
        user_id: User identifier
        tags: Optional categorization tags
        importance: 1-5 scale (5 = most important)
    
    Returns:
        True if saved successfully, False otherwise
    """
    if not content or not content.strip():
        return False

    try:
        col = await _get_col()
        if col is None:
            logger.warning("[MemoryService] MongoDB not available — memory not saved")
            return False

        now = datetime.now(timezone.utc)
        doc = {
            "user_id": user_id,
            "session_id": session_id,
            "content": content.strip(),
            "tags": tags or [],
            "importance": max(1, min(5, importance)),
            "created_at": now,
            "updated_at": now,
        }
        await col.insert_one(doc)

        # Trim to max memories per user (keep most important/recent)
        count = await col.count_documents({"user_id": user_id})
        if count > _MAX_MEMORIES_PER_USER:
            # Delete oldest low-importance memories
            oldest = await col.find(
                {"user_id": user_id},
                sort=[("importance", 1), ("created_at", 1)],
                limit=count - _MAX_MEMORIES_PER_USER,
            ).to_list(None)
            if oldest:
                ids = [d["_id"] for d in oldest]
                await col.delete_many({"_id": {"$in": ids}})

        logger.info("[MemoryService] Saved memory for user %s (session %s)", user_id, session_id)
        return True

    except Exception as e:
        logger.warning("[MemoryService] Failed to save memory: %s", e)
        return False


async def load_memories(
    user_id: str = "auto-user",
    tags: Optional[List[str]] = None,
    limit: int = _MAX_MEMORIES_IN_PROMPT,
) -> List[Dict[str, Any]]:
    """Load relevant agent memories for a user.
    
    Args:
        user_id: User identifier
        tags: Optional filter by tags (OR logic)
        limit: Maximum memories to return
    
    Returns:
        List of memory documents sorted by importance desc, created_at desc
    """
    try:
        col = await _get_col()
        if col is None:
            return []

        query: Dict[str, Any] = {"user_id": user_id}
        if tags:
            query["tags"] = {"$in": tags}

        cursor = col.find(
            query,
            sort=[("importance", -1), ("created_at", -1)],
            limit=limit,
        )
        docs = await cursor.to_list(None)
        return [
            {
                "content": d.get("content", ""),
                "tags": d.get("tags", []),
                "importance": d.get("importance", 3),
                "session_id": d.get("session_id", ""),
                "created_at": d.get("created_at", "").isoformat() if hasattr(d.get("created_at", ""), "isoformat") else str(d.get("created_at", "")),
            }
            for d in docs
        ]

    except Exception as e:
        logger.warning("[MemoryService] Failed to load memories: %s", e)
        return []


def format_memories_for_prompt(memories: List[Dict[str, Any]]) -> str:
    """Format memory list into a string for injection into the system prompt."""
    if not memories:
        return ""

    lines = ["## Agent Memory (Facts from previous sessions):\n"]
    for i, mem in enumerate(memories, 1):
        tags_str = f" [{', '.join(mem['tags'])}]" if mem.get("tags") else ""
        lines.append(f"{i}. {mem['content']}{tags_str}")

    return "\n".join(lines)


async def extract_and_save_insights(
    messages: List[Dict[str, Any]],
    session_id: str,
    user_id: str = "auto-user",
) -> int:
    """Extract important insights from a completed session and save to memory.
    
    Looks for patterns in assistant messages that indicate learnable facts:
    - User preferences
    - Project-specific facts
    - Recurring patterns
    
    Returns number of memories saved.
    """
    if not messages:
        return 0

    saved = 0
    try:
        # Extract user preferences and facts from the last few assistant messages
        assistant_messages = [
            m.get("content", "")
            for m in messages
            if m.get("role") == "assistant" and m.get("content")
        ]

        # Simple heuristic: look for sentences that contain preference/fact markers
        _MARKERS = [
            "user prefers", "user likes", "user wants", "note that", "remember that",
            "important:", "user's preference", "project uses", "always use",
            "the user", "preferred format", "project name", "working directory",
        ]

        for msg_content in assistant_messages[-5:]:
            lines = msg_content.split("\n")
            for line in lines:
                line = line.strip()
                if len(line) < 20 or len(line) > 300:
                    continue
                lower = line.lower()
                if any(marker in lower for marker in _MARKERS):
                    tags = ["auto_extracted"]
                    if "prefer" in lower or "like" in lower:
                        tags.append("preference")
                    if "project" in lower or "directory" in lower:
                        tags.append("project")

                    ok = await save_memory(
                        content=line,
                        session_id=session_id,
                        user_id=user_id,
                        tags=tags,
                        importance=2,
                    )
                    if ok:
                        saved += 1

    except Exception as e:
        logger.warning("[MemoryService] extract_and_save_insights failed: %s", e)

    return saved
