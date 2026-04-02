"""
Redis Stream Queue for Dzeck AI Agent event publishing.
Ported from ai-manus/backend/app/infrastructure/external/message_queue/redis_stream_queue.py.

Each agent session gets its own Redis Stream: stream:session:<session_id>
Events are published via XADD and can be replayed via XRANGE.
The Node.js SSE layer reads from these streams via XREAD.
"""
import os
import json
import logging
from typing import Any, Optional, List, Tuple

logger = logging.getLogger(__name__)

_redis_available = False
try:
    import redis.asyncio as aioredis
    _redis_available = True
except ImportError:
    try:
        import aioredis  # type: ignore
        _redis_available = True
    except ImportError:
        logger.warning("[RedisStreamQueue] redis package not installed. Stream queuing disabled.")


def _stream_key(session_id: str) -> str:
    # stream:session:<id> — matches routes.ts redisXRange(`stream:session:${sid}`)
    return f"stream:session:{session_id}"


class RedisStreamQueue:
    """
    Redis Stream-based event queue for a single agent session.
    Provides XADD (publish), XREAD (consume new), XRANGE (replay all).
    """

    def __init__(self, session_id: str) -> None:
        self._session_id = session_id
        self._stream_key = _stream_key(session_id)
        self._client: Any = None
        self._connected = False
        self._connect_attempted = False

    async def connect(self) -> bool:
        if self._connect_attempted:
            return self._connected
        self._connect_attempted = True

        if not _redis_available:
            logger.warning("[RedisStreamQueue] redis not available, stream queue disabled.")
            return False

        redis_url = os.environ.get("REDIS_URL", "")
        redis_host = os.environ.get("REDIS_HOST", "")
        redis_port = int(os.environ.get("REDIS_PORT", "6379"))
        redis_pass = os.environ.get("REDIS_PASSWORD", "")

        if not redis_url and not redis_host:
            logger.warning("[RedisStreamQueue] REDIS_URL/REDIS_HOST not set, stream queue disabled.")
            return False

        try:
            if not redis_url:
                if redis_pass:
                    redis_url = f"redis://:{redis_pass}@{redis_host}:{redis_port}/0"
                else:
                    redis_url = f"redis://{redis_host}:{redis_port}/0"

            if hasattr(aioredis, "from_url"):
                self._client = aioredis.from_url(
                    redis_url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5,
                )
            else:
                self._client = await aioredis.create_redis_pool(
                    redis_url,
                    encoding="utf-8",
                    timeout=5,
                )
            await self._client.ping()
            self._connected = True
            logger.info("[RedisStreamQueue] Connected for session %s.", self._session_id)
            return True
        except Exception as exc:
            logger.warning("[RedisStreamQueue] Redis connect failed: %s", exc)
            self._connected = False
            return False

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def xadd(self, data: Any) -> Optional[str]:
        """Append an event to the stream. Returns entry ID or None on failure.
        Stream is capped at 2000 entries (approximate) to prevent Redis OOM."""
        if not self._connected:
            return None
        try:
            if not isinstance(data, str):
                data = json.dumps(data, default=str)
            entry_id = await self._client.xadd(
                self._stream_key,
                {"data": data},
                maxlen=2000,
                approximate=True,
            )
            return entry_id
        except Exception as exc:
            logger.warning("[RedisStreamQueue] XADD failed: %s", exc)
            return None

    async def xread(self, last_id: str = "0", count: int = 100) -> List[Tuple[str, Any]]:
        """Read entries from stream after last_id. Returns [(id, data), ...]."""
        if not self._connected:
            return []
        try:
            results = await self._client.xread({self._stream_key: last_id}, count=count)
            if not results:
                return []
            entries = []
            for _stream, msgs in results:
                for entry_id, fields in msgs:
                    raw = fields.get("data") if isinstance(fields, dict) else None
                    if raw is not None:
                        try:
                            parsed = json.loads(raw)
                        except Exception:
                            parsed = raw
                        entries.append((entry_id, parsed))
            return entries
        except Exception as exc:
            logger.warning("[RedisStreamQueue] XREAD failed: %s", exc)
            return []

    async def xrange(self, start_id: str = "-", end_id: str = "+", count: int = 1000) -> List[Tuple[str, Any]]:
        """Read all entries in range. Returns [(id, data), ...]."""
        if not self._connected:
            return []
        try:
            results = await self._client.xrange(self._stream_key, start_id, end_id, count=count)
            if not results:
                return []
            entries = []
            for entry_id, fields in results:
                raw = fields.get("data") if isinstance(fields, dict) else None
                if raw is not None:
                    try:
                        parsed = json.loads(raw)
                    except Exception:
                        parsed = raw
                    entries.append((entry_id, parsed))
            return entries
        except Exception as exc:
            logger.warning("[RedisStreamQueue] XRANGE failed: %s", exc)
            return []

    async def get_latest_id(self) -> str:
        """Return the latest entry ID in the stream, or '0' if empty."""
        if not self._connected:
            return "0"
        try:
            results = await self._client.xrevrange(self._stream_key, "+", "-", count=1)
            if results:
                return results[0][0]
            return "0"
        except Exception:
            return "0"

    async def size(self) -> int:
        """Return number of entries in the stream."""
        if not self._connected:
            return 0
        try:
            return await self._client.xlen(self._stream_key)
        except Exception:
            return 0

    async def clear(self) -> None:
        """Trim the stream to 0 entries."""
        if not self._connected:
            return
        try:
            await self._client.xtrim(self._stream_key, 0)
        except Exception:
            pass

    async def close(self) -> None:
        if self._client:
            try:
                if hasattr(self._client, "aclose"):
                    await self._client.aclose()
                else:
                    await self._client.close()
            except Exception:
                pass
            self._connected = False


_queues: dict = {}


async def get_stream_queue(session_id: str) -> RedisStreamQueue:
    """Get or create a RedisStreamQueue singleton for a session."""
    if session_id not in _queues:
        q = RedisStreamQueue(session_id)
        await q.connect()
        _queues[session_id] = q
    return _queues[session_id]
