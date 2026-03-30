"""
MongoDB schema initialization for Dzeck AI Agent.
Creates all required collections and indexes on startup.
Call initialize_schema() once when the agent starts up.
"""
import os
import logging
from typing import Any

logger = logging.getLogger(__name__)

_motor_available = False
try:
    from motor.motor_asyncio import AsyncIOMotorClient
    _motor_available = True
except ImportError:
    logger.warning("[Schema] motor not installed. Schema initialization disabled.")


async def initialize_schema(uri: str = "", db_name: str = "manus") -> bool:
    """
    Create all required MongoDB collections and indexes.

    Args:
        uri: MongoDB connection URI. If not provided, reads MONGODB_URI from env.
        db_name: Database name. Defaults to 'manus'.

    Returns:
        True if successful, False if skipped/failed.
    """
    if not _motor_available:
        logger.warning("[Schema] motor not available — schema initialization skipped.")
        return False

    mongo_uri = uri or os.environ.get("MONGODB_URI", "")
    if not mongo_uri:
        logger.warning("[Schema] MONGODB_URI not set — schema initialization skipped.")
        return False

    try:
        client: Any = AsyncIOMotorClient(
            mongo_uri,
            serverSelectionTimeoutMS=5000,
            connectTimeoutMS=5000,
        )
        db = client[db_name]
        await client.admin.command("ping")
        logger.info("[Schema] Connected to MongoDB for schema initialization.")
    except Exception as exc:
        logger.warning("[Schema] MongoDB connection failed: %s — schema initialization skipped.", exc)
        return False

    try:
        # ── sessions collection ──────────────────────────────────────────────
        sessions = db["sessions"]
        try:
            await sessions.create_index("session_id", unique=True, sparse=True)
        except Exception:
            pass
        await sessions.create_index("user_id")
        await sessions.create_index([("created_at", -1)])
        await sessions.create_index("status")
        logger.debug("[Schema] sessions indexes ensured.")

        # ── session_events collection ────────────────────────────────────────
        events = db["session_events"]
        await events.create_index([("session_id", 1), ("timestamp", -1)])
        await events.create_index("session_id")
        logger.debug("[Schema] session_events indexes ensured.")

        # ── messages collection ──────────────────────────────────────────────
        messages = db["messages"]
        await messages.create_index([("session_id", 1), ("created_at", 1)])
        await messages.create_index("session_id")
        logger.debug("[Schema] messages indexes ensured.")

        # ── files collection (GridFS metadata reference) ─────────────────────
        files = db["files"]
        await files.create_index("session_id")
        try:
            await files.create_index("file_id", unique=True, sparse=True)
        except Exception:
            pass
        logger.debug("[Schema] files indexes ensured.")

        # ── session_files collection (E2B sandbox file tracking) ─────────────
        session_files = db["session_files"]
        await session_files.create_index([("session_id", 1), ("created_at", 1)])
        await session_files.create_index([("session_id", 1), ("path", 1)])
        logger.debug("[Schema] session_files indexes ensured.")

        # ── users collection ─────────────────────────────────────────────────
        users = db["users"]
        try:
            await users.create_index("username", unique=True, sparse=True)
        except Exception:
            pass
        try:
            await users.create_index("id", unique=True, sparse=True)
        except Exception:
            pass
        logger.debug("[Schema] users indexes ensured.")

        # ── agent_sessions collection (Node.js agent session records) ─────────
        agent_sessions = db["agent_sessions"]
        await agent_sessions.create_index("session_id")
        await agent_sessions.create_index("user_id")
        await agent_sessions.create_index([("created_at", -1)])
        logger.debug("[Schema] agent_sessions indexes ensured.")

        # ── plans collection (agent execution plans) ─────────────────────────
        plans = db["plans"]
        await plans.create_index("session_id")
        await plans.create_index("user_id")
        await plans.create_index([("session_id", 1), ("created_at", -1)])
        logger.debug("[Schema] plans indexes ensured.")

        # ── GridFS bucket indexes (agent_files) ──────────────────────────────
        agent_files_files = db["agent_files.files"]
        await agent_files_files.create_index("metadata.session_id")
        await agent_files_files.create_index("metadata.user_id")
        logger.debug("[Schema] agent_files GridFS indexes ensured.")

        logger.info("[Schema] All MongoDB indexes initialized successfully.")
        client.close()
        return True

    except Exception as exc:
        logger.warning("[Schema] Index creation warning: %s", exc)
        try:
            client.close()
        except Exception:
            pass
        return False
