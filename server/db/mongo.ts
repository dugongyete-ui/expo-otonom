import { MongoClient, Db, Collection } from "mongodb";

let _client: MongoClient | null = null;
let _db: Db | null = null;
let _connected = false;
let _lastFailedAt = 0;
const RETRY_COOLDOWN_MS = 30_000;

function getMongoUri(): string {
  return process.env.MONGODB_URI || "";
}

export async function getMongoDb(): Promise<Db | null> {
  if (_connected && _db) {
    return _db;
  }

  const uri = getMongoUri();
  if (!uri) {
    return null;
  }

  const now = Date.now();
  if (_lastFailedAt > 0 && now - _lastFailedAt < RETRY_COOLDOWN_MS) {
    return null;
  }

  try {
    if (_client) {
      try { await _client.close(); } catch {}
      _client = null;
    }
    _client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
    });
    await _client.connect();
    _db = _client.db("manus");
    _connected = true;
    _lastFailedAt = 0;
    console.log("[MongoDB] Connected successfully.");
    _client.on("close", () => {
      _connected = false;
      _lastFailedAt = Date.now();
      console.warn("[MongoDB] Connection closed — will retry on next request.");
    });
    _client.on("error", (err: Error) => {
      _connected = false;
      _lastFailedAt = Date.now();
      console.warn("[MongoDB] Connection error:", err.message);
    });
    return _db;
  } catch (err: any) {
    console.warn("[MongoDB] Connection failed:", err.message);
    _connected = false;
    _lastFailedAt = Date.now();
    return null;
  }
}

export async function getCollection<T extends object = object>(name: string): Promise<Collection<T> | null> {
  const db = await getMongoDb();
  if (!db) return null;
  return db.collection<T>(name);
}

export function isMongoConnected(): boolean {
  return _connected;
}

export async function closeMongoConnection(): Promise<void> {
  if (_client) {
    try {
      await _client.close();
    } catch {}
    _client = null;
    _db = null;
    _connected = false;
    _lastFailedAt = 0;
  }
}
