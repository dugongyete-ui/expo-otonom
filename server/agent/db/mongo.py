"""
Shared synchronous MongoDB client for Dzeck AI Agent tools.
Provides a singleton pymongo client to avoid per-call connection churn
in task.py, todo.py, and other tool modules.
"""
import os
import logging
from typing import Optional

logger = logging.getLogger(__name__)

_client = None
_db = None
_uri: str = ""


def _get_uri() -> str:
    return os.environ.get("MONGODB_URI", "")


def get_db():
    """Return a singleton pymongo Database instance, or None if unavailable."""
    global _client, _db, _uri

    current_uri = _get_uri()
    if not current_uri:
        return None

    if _db is not None and _uri == current_uri:
        try:
            _client.admin.command("ping")
            return _db
        except Exception:
            _db = None
            _client = None

    try:
        import pymongo
        _client = pymongo.MongoClient(
            current_uri,
            serverSelectionTimeoutMS=3000,
            connectTimeoutMS=3000,
        )
        _db_name = os.environ.get("MONGO_DB_NAME", "manus")
        _db = _client[_db_name]
        _uri = current_uri
        logger.debug("[AgentMongo] Connected successfully.")
        return _db
    except Exception as exc:
        logger.warning("[AgentMongo] Connection failed: %s", exc)
        _db = None
        _client = None
        return None


def get_collection(name: str):
    """Return a pymongo Collection by name, or None if unavailable."""
    db = get_db()
    if db is None:
        return None
    return db[name]
