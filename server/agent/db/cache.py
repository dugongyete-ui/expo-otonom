"""
Redis cache layer for Dzeck AI Agent.
DDD pattern: Infrastructure / Cache Layer.

Used for:
- Session state caching (fast access without MongoDB hit)
- Rate limiting per session
- Temporary storage of agent working memory
"""
import os
import json
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_redis_available = False
try:
    import redis.asyncio as aioredis
    _redis_available = True
except ImportError:
    try:
        import aioredis
        _redis_available = True
    except ImportError:
        logger.warning("[CacheStore] redis package not installed. Redis caching disabled.")


class CacheStore:
    """
    Redis-backed cache store.
    Provides fast session state access and working memory storage.
    """

    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        password: Optional[str] = None,
        default_ttl: int = 86400,
    ) -> None:
        self._host = host or os.environ.get("REDIS_HOST", "")
        self._port = port or int(os.environ.get("REDIS_PORT", "6379"))
        self._password = password or os.environ.get("REDIS_PASSWORD", "")
        self._redis_url = os.environ.get("REDIS_URL", "")
        self._default_ttl = default_ttl
        self._client: Any = None
        self._connected = False
        self._connect_attempted = False

    async def connect(self) -> bool:
        """Connect to Redis. Returns True on success. Only attempts once."""
        if self._connect_attempted:
            return self._connected
        self._connect_attempted = True

        if not _redis_available:
            logger.warning("[CacheStore] redis not available, skipping connect.")
            return False

        if not self._redis_url and not self._host:
            logger.warning("[CacheStore] REDIS_URL/REDIS_HOST not set, skipping Redis connect.")
            return False

        try:
            if hasattr(aioredis, 'from_url'):
                if self._redis_url:
                    url = self._redis_url
                elif self._password:
                    url = f"redis://:{self._password}@{self._host}:{self._port}/0"
                else:
                    url = f"redis://{self._host}:{self._port}/0"
                self._client = aioredis.from_url(
                    url,
                    encoding="utf-8",
                    decode_responses=True,
                    socket_connect_timeout=5,
                    socket_timeout=5,
                    retry_on_timeout=False,
                )
            else:
                self._client = await aioredis.create_redis_pool(
                    self._redis_url or f"redis://{self._host}:{self._port}",
                    password=self._password or None,
                    encoding="utf-8",
                    timeout=5,
                )
            await self._client.ping()
            self._connected = True
            logger.info("[CacheStore] Connected to Redis.")
            return True
        except Exception as e:
            logger.warning("[CacheStore] Redis unavailable (will run without cache): %s", e)
            self._connected = False
            return False

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def set(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ) -> bool:
        """Set a key with optional TTL (seconds)."""
        if not self._connected:
            return False
        try:
            if not isinstance(value, str):
                value = json.dumps(value, default=str)
            expire = ttl or self._default_ttl
            await self._client.setex(key, expire, value)
            return True
        except Exception as e:
            logger.error("[CacheStore] set error for key %s: %s", key, e)
            return False

    async def get(self, key: str) -> Optional[Any]:
        """Get a value by key. Returns None if not found."""
        if not self._connected:
            return None
        try:
            raw = await self._client.get(key)
            if raw is None:
                return None
            try:
                return json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                return raw
        except Exception as e:
            logger.error("[CacheStore] get error for key %s: %s", key, e)
            return None

    async def delete(self, key: str) -> bool:
        """Delete a key."""
        if not self._connected:
            return False
        try:
            await self._client.delete(key)
            return True
        except Exception as e:
            logger.error("[CacheStore] delete error for key %s: %s", key, e)
            return False

    async def exists(self, key: str) -> bool:
        """Check if a key exists."""
        if not self._connected:
            return False
        try:
            return bool(await self._client.exists(key))
        except Exception as e:
            logger.error("[CacheStore] exists error for key %s: %s", key, e)
            return False

    async def expire(self, key: str, ttl: int) -> bool:
        """Set TTL on existing key."""
        if not self._connected:
            return False
        try:
            await self._client.expire(key, ttl)
            return True
        except Exception as e:
            logger.error("[CacheStore] expire error for key %s: %s", key, e)
            return False

    async def cache_session_state(
        self,
        session_id: str,
        state: Dict[str, Any],
        ttl: int = 3600,
    ) -> bool:
        """Cache session state for fast retrieval."""
        key = f"session:state:{session_id}"
        return await self.set(key, state, ttl=ttl)

    async def get_session_state(
        self,
        session_id: str,
    ) -> Optional[Dict[str, Any]]:
        """Retrieve cached session state."""
        key = f"session:state:{session_id}"
        return await self.get(key)

    async def invalidate_session(self, session_id: str) -> None:
        """Remove all cached data for a session."""
        keys = [
            f"session:state:{session_id}",
            f"session:memory:{session_id}",
            f"session:plan:{session_id}",
        ]
        for key in keys:
            await self.delete(key)

    async def cache_plan(
        self,
        session_id: str,
        plan: Dict[str, Any],
        ttl: int = 3600,
    ) -> bool:
        """Cache the agent's current plan."""
        key = f"session:plan:{session_id}"
        return await self.set(key, plan, ttl=ttl)

    async def get_plan(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve cached plan."""
        key = f"session:plan:{session_id}"
        return await self.get(key)

    async def cache_memory(
        self,
        session_id: str,
        messages: list,
        ttl: int = 3600,
    ) -> bool:
        """Cache agent working memory (message history)."""
        key = f"session:memory:{session_id}"
        return await self.set(key, messages, ttl=ttl)

    async def get_memory(self, session_id: str) -> Optional[list]:
        """Retrieve cached working memory."""
        key = f"session:memory:{session_id}"
        return await self.get(key)

    async def cache_chat_history(
        self,
        session_id: str,
        history: list,
        ttl: int = 86400,
    ) -> bool:
        """Cache conversation history (user+assistant turns) for a session."""
        key = f"session:chat:{session_id}"
        return await self.set(key, history, ttl=ttl)

    async def get_chat_history(self, session_id: str) -> Optional[list]:
        """Retrieve cached conversation history."""
        key = f"session:chat:{session_id}"
        return await self.get(key)

    async def close(self) -> None:
        """Close the Redis connection."""
        if self._client:
            try:
                if hasattr(self._client, 'aclose'):
                    await self._client.aclose()
                else:
                    await self._client.close()
            except Exception:
                pass
            self._connected = False


_cache_store: Optional[CacheStore] = None


async def get_cache_store() -> CacheStore:
    """Get or create the global cache store singleton."""
    global _cache_store
    if _cache_store is None:
        _cache_store = CacheStore()
        await _cache_store.connect()
    return _cache_store
