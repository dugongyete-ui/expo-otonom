/**
 * Redis client for session persistence and agent event streaming.
 * Used by e2b-desktop.ts to persist E2B session metadata across server restarts.
 * Provides Redis Streams (XADD/XREAD/XRANGE) for agent event queuing per session.
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

// ─── Redis Streams (XADD / XREAD / XRANGE) ──────────────────────────────────
// Used for agent event queuing per session (replay support).
// ioredis v5 exposes xadd/xread/xrange with full TypeScript types.

type StreamEntry = { id: string; fields: Record<string, string> };

function parseStreamEntries(raw: [id: string, fields: string[]][]): StreamEntry[] {
  return raw.map(([id, rawFields]) => {
    const fields: Record<string, string> = {};
    for (let i = 0; i < rawFields.length; i += 2) {
      fields[rawFields[i]] = rawFields[i + 1];
    }
    return { id, fields };
  });
}

/**
 * XADD: Append an event to a Redis Stream for a session.
 * @param streamKey e.g. "stream:session:<sessionId>"
 * @param fields     flat key-value pairs (e.g. { data: "..." })
 * @returns the stream entry ID, or null on failure
 */
export async function redisXAdd(streamKey: string, fields: Record<string, string>): Promise<string | null> {
  const client = getRedisClient();
  if (!client) return null;
  try {
    const kvPairs: string[] = [];
    for (const [k, v] of Object.entries(fields)) {
      kvPairs.push(k, v);
    }
    const id = await client.xadd(streamKey, "*", ...kvPairs);
    return id;
  } catch (err: any) {
    console.warn("[Redis] XADD failed:", err.message);
    return null;
  }
}

/**
 * XREAD: Read entries from a Redis Stream starting from a given ID.
 * @param streamKey   e.g. "stream:session:<sessionId>"
 * @param lastId      last seen entry ID ("0" to start from beginning, "$" for new only)
 * @param count       max entries to fetch
 */
export async function redisXRead(
  streamKey: string,
  lastId: string = "0",
  count: number = 100,
): Promise<StreamEntry[]> {
  const client = getRedisClient();
  if (!client) return [];
  try {
    const results = await client.xread("COUNT", count, "STREAMS", streamKey, lastId);
    if (!results || !results.length) return [];
    const [, entries] = results[0];
    return parseStreamEntries(entries);
  } catch (err: any) {
    console.warn("[Redis] XREAD failed:", err.message);
    return [];
  }
}

/**
 * XRANGE: Get all entries in a stream between start and end IDs.
 * Use "-" for start (earliest) and "+" for end (latest).
 */
export async function redisXRange(
  streamKey: string,
  startId: string = "-",
  endId: string = "+",
  count: number = 1000,
): Promise<StreamEntry[]> {
  const client = getRedisClient();
  if (!client) return [];
  try {
    const entries = await client.xrange(streamKey, startId, endId, "COUNT", count);
    if (!entries || !entries.length) return [];
    return parseStreamEntries(entries);
  } catch (err: any) {
    console.warn("[Redis] XRANGE failed:", err.message);
    return [];
  }
}
