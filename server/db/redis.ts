/**
 * Redis client for session persistence.
 * Used by e2b-desktop.ts to persist E2B session metadata across server restarts.
 * Falls back gracefully if Redis is unavailable.
 */
import Redis from "ioredis";

let _client: Redis | null = null;
let _connected = false;
let _lastFailedAt = 0;
const RETRY_COOLDOWN_MS = 30_000;

function getRedisConfig(): { host: string; port: number; password?: string } | null {
  const host = process.env.REDIS_HOST || "";
  const port = parseInt(process.env.REDIS_PORT || "6379", 10);
  const password = process.env.REDIS_PASSWORD || process.env.REDIS_PASS || undefined;
  if (!host) return null;
  return { host, port, password };
}

export function getRedisClient(): Redis | null {
  const now = Date.now();
  if (_connected && _client) return _client;
  if (_lastFailedAt > 0 && now - _lastFailedAt < RETRY_COOLDOWN_MS) return null;

  const config = getRedisConfig();
  if (!config) return null;

  try {
    if (_client) {
      _client.disconnect();
      _client = null;
    }
    _client = new Redis({
      host: config.host,
      port: config.port,
      password: config.password,
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });

    _client.on("connect", () => {
      _connected = true;
      _lastFailedAt = 0;
      console.log("[Redis] Connected successfully.");
    });

    _client.on("error", (err: Error) => {
      _connected = false;
      _lastFailedAt = Date.now();
      console.warn("[Redis] Connection error:", err.message);
    });

    _client.on("close", () => {
      _connected = false;
    });

    _client.connect().catch((err: Error) => {
      _connected = false;
      _lastFailedAt = Date.now();
      console.warn("[Redis] Initial connect failed:", err.message);
    });

    return _client;
  } catch (err: any) {
    _connected = false;
    _lastFailedAt = Date.now();
    console.warn("[Redis] Failed to create client:", err.message);
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  try {
    if (ttlSeconds) {
      await client.set(key, value, "EX", ttlSeconds);
    } else {
      await client.set(key, value);
    }
    return true;
  } catch (err: any) {
    console.warn("[Redis] SET failed:", err.message);
    return false;
  }
}

export async function redisGet(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    return await client.get(key);
  } catch (err: any) {
    console.warn("[Redis] GET failed:", err.message);
    return null;
  }
}

export async function redisDel(key: string): Promise<boolean> {
  const client = getRedisClient();
  if (!client) return false;
  try {
    await client.del(key);
    return true;
  } catch (err: any) {
    console.warn("[Redis] DEL failed:", err.message);
    return false;
  }
}

export async function redisKeys(pattern: string): Promise<string[]> {
  const client = getRedisClient();
  if (!client) return [];
  try {
    return await client.keys(pattern);
  } catch (err: any) {
    console.warn("[Redis] KEYS failed:", err.message);
    return [];
  }
}
