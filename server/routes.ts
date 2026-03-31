import { type Server, createServer } from "node:http";
import { spawn } from "node:child_process";
import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import multer from "multer";
import { getActiveE2BSandboxId, createAndRegisterE2BSandbox, registerExternalE2BSandbox, getSessionBySandboxId, linkAgentSessionToSandbox } from "./e2b-desktop";
import { requireAuth, requireAdmin } from "./auth-routes";
import { getCollection, getMongoDb } from "./db/mongo";
import { redisXRead, redisXRange, redisSet, redisGet, redisDel, getRedisClient } from "./db/redis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _require = createRequire(import.meta.url);

// ─── Multer Upload Config (memory storage — files pushed directly to E2B) ────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── E2B Cloud Sandbox (replaces VNC) ────────────────────────────────────────
// NOTE: E2B_ENABLED must be a function, not a const, because .env is loaded
// AFTER ESM imports are evaluated. A const here would always be false when
// E2B_API_KEY is only set in .env (not in the actual process environment).
function isE2BEnabled(): boolean {
  return !!process.env.E2B_API_KEY;
}

function getCerebrasConfig() {
  const apiKey = process.env.CEREBRAS_API_KEY || "";
  const model = process.env.CEREBRAS_CHAT_MODEL || "qwen-3-235b-a22b-instruct-2507";
  const agentModel = process.env.CEREBRAS_AGENT_MODEL || "qwen-3-235b-a22b-instruct-2507";
  const hostname = "api.cerebras.ai";
  const path = "/v1/chat/completions";
  return { apiKey, model, agentModel, hostname, path };
}

function setupSSEHeaders(res: any) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}

export async function registerRoutes(app: any): Promise<Server> {
  const startupCfg = getCerebrasConfig();
  if (!startupCfg.apiKey) {
    console.warn("[WARNING] CEREBRAS_API_KEY is not set. AI features will not work.");
  }

  app.get("/status", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/status", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), e2bEnabled: isE2BEnabled() });
  });

  // ─── Config API (runtime config without restart) ──────────────────────────
  // Load persisted config from MongoDB on startup and apply to process.env
  (async () => {
    try {
      const col = await getCollection("app_config");
      if (col) {
        const doc = await (col as any).findOne({ _type: "app_config" }, { projection: { _id: 0 } });
        if (doc) {
          // .env always wins for model config — only apply MongoDB values if .env is not set
          if (doc.CEREBRAS_CHAT_MODEL && !process.env.CEREBRAS_CHAT_MODEL) process.env.CEREBRAS_CHAT_MODEL = doc.CEREBRAS_CHAT_MODEL;
          if (doc.CEREBRAS_AGENT_MODEL && !process.env.CEREBRAS_AGENT_MODEL) process.env.CEREBRAS_AGENT_MODEL = doc.CEREBRAS_AGENT_MODEL;
          if (doc.SEARCH_PROVIDER && !process.env.SEARCH_PROVIDER) process.env.SEARCH_PROVIDER = doc.SEARCH_PROVIDER;
          if (doc.GOOGLE_SEARCH_API_KEY && !process.env.GOOGLE_SEARCH_API_KEY) process.env.GOOGLE_SEARCH_API_KEY = doc.GOOGLE_SEARCH_API_KEY;
          if (doc.GOOGLE_SEARCH_ENGINE_ID && !process.env.GOOGLE_SEARCH_ENGINE_ID) process.env.GOOGLE_SEARCH_ENGINE_ID = doc.GOOGLE_SEARCH_ENGINE_ID;
          if (doc.GOOGLE_CSE_ID && !process.env.GOOGLE_CSE_ID) process.env.GOOGLE_CSE_ID = doc.GOOGLE_CSE_ID;
          if (doc.MODEL_PROVIDER && !process.env.MODEL_PROVIDER) process.env.MODEL_PROVIDER = doc.MODEL_PROVIDER;
          console.log("[Config] Loaded persisted config from MongoDB (skipped keys already set in .env):", {
            CEREBRAS_CHAT_MODEL: process.env.CEREBRAS_CHAT_MODEL,
            CEREBRAS_AGENT_MODEL: process.env.CEREBRAS_AGENT_MODEL,
            SEARCH_PROVIDER: process.env.SEARCH_PROVIDER,
            GOOGLE_SEARCH_CONFIGURED: !!(process.env.GOOGLE_SEARCH_API_KEY && (process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID)),
          });
        }
      }
    } catch (err: any) {
      console.warn("[Config] Failed to load persisted config from MongoDB:", err.message);
    }
  })();

  // Available model/provider options.
  // These can be overridden by setting AVAILABLE_MODELS and AVAILABLE_PROVIDERS env vars
  // (JSON arrays of {label, value} pairs).
  const DEFAULT_MODELS = [
    { label: "Qwen 3 235B (Default)", value: "qwen-3-235b-a22b-instruct-2507" },
    { label: "Qwen 3 32B", value: "qwen-3-32b" },
    { label: "Llama 4 Scout", value: "llama-4-scout-17b-16e-instruct" },
    { label: "Llama 4 Maverick", value: "llama-4-maverick-17b-128e-instruct" },
    { label: "Llama 3.3 70B", value: "llama-3.3-70b" },
  ];
  const DEFAULT_PROVIDERS = [
    { label: "Cerebras", value: "cerebras" },
    { label: "OpenAI", value: "openai" },
    { label: "Anthropic", value: "anthropic" },
  ];
  const DEFAULT_SEARCH_PROVIDERS = [
    { label: "Bing Web", value: "bing_web" },
    { label: "Google", value: "google" },
    { label: "DuckDuckGo", value: "duckduckgo" },
  ];

  function _parseJsonEnvList(envVar: string, fallback: Array<{ label: string; value: string }>) {
    const raw = process.env[envVar];
    if (!raw) return fallback;
    try { return JSON.parse(raw) as Array<{ label: string; value: string }>; } catch { return fallback; }
  }

  app.get("/api/config", (_req: any, res: any) => {
    res.json({
      CEREBRAS_CHAT_MODEL: process.env.CEREBRAS_CHAT_MODEL || "qwen-3-235b-a22b-instruct-2507",
      CEREBRAS_AGENT_MODEL: process.env.CEREBRAS_AGENT_MODEL || "qwen-3-235b-a22b-instruct-2507",
      SEARCH_PROVIDER: process.env.SEARCH_PROVIDER || "bing_web",
      GOOGLE_SEARCH_CONFIGURED: !!(process.env.GOOGLE_SEARCH_API_KEY && (process.env.GOOGLE_SEARCH_ENGINE_ID || process.env.GOOGLE_CSE_ID)),
      AUTH_PROVIDER: process.env.AUTH_PROVIDER || "none",
      E2B_ENABLED: isE2BEnabled(),
      authProvider: process.env.AUTH_PROVIDER || "none",
      modelName: process.env.CEREBRAS_AGENT_MODEL || "qwen-3-235b-a22b-instruct-2507",
      modelProvider: process.env.MODEL_PROVIDER || "cerebras",
      searchProvider: process.env.SEARCH_PROVIDER || "bing_web",
      showGithubButton: process.env.SHOW_GITHUB_BUTTON === "true",
      MCP_SERVER_URL: process.env.MCP_SERVER_URL || "",
      MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN ? "***" : "",
      EMAIL_ENABLED: !!(process.env.EMAIL_HOST),
      // Dynamic lists consumed by SettingsPanel (can be overridden via env vars)
      available_models: _parseJsonEnvList("AVAILABLE_MODELS", DEFAULT_MODELS),
      available_providers: _parseJsonEnvList("AVAILABLE_PROVIDERS", DEFAULT_PROVIDERS),
      available_search_providers: _parseJsonEnvList("AVAILABLE_SEARCH_PROVIDERS", DEFAULT_SEARCH_PROVIDERS),
    });
  });

  app.put("/api/config", requireAdmin, async (req: any, res: any) => {
    const allowed = ["CEREBRAS_CHAT_MODEL", "CEREBRAS_AGENT_MODEL", "SEARCH_PROVIDER", "MODEL_PROVIDER", "SHOW_GITHUB_BUTTON", "GOOGLE_SEARCH_API_KEY", "GOOGLE_SEARCH_ENGINE_ID", "GOOGLE_CSE_ID"];
    const updates: Record<string, string> = {};

    for (const key of allowed) {
      if (req.body && typeof req.body[key] === "string" && req.body[key].trim()) {
        updates[key] = req.body[key].trim();
        process.env[key] = updates[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid config fields provided. Allowed: " + allowed.join(", ") });
    }

    // Persist to MongoDB so config survives server restarts
    try {
      const col = await getCollection("app_config");
      if (col) {
        await (col as any).updateOne(
          { _type: "app_config" },
          { $set: { ...updates, _type: "app_config", updated_at: new Date() } },
          { upsert: true },
        );
      }
    } catch (err: any) {
      console.warn("[Config] Failed to persist config to MongoDB:", err.message);
    }

    console.log("[Config] Runtime config updated:", updates);
    res.json({
      updated: updates,
      current: {
        CEREBRAS_CHAT_MODEL: process.env.CEREBRAS_CHAT_MODEL || "qwen-3-235b-a22b-instruct-2507",
        CEREBRAS_AGENT_MODEL: process.env.CEREBRAS_AGENT_MODEL || "qwen-3-235b-a22b-instruct-2507",
        SEARCH_PROVIDER: process.env.SEARCH_PROVIDER || "bing_web",
        MODEL_PROVIDER: process.env.MODEL_PROVIDER || "cerebras",
        SHOW_GITHUB_BUTTON: process.env.SHOW_GITHUB_BUTTON || "false",
      },
    });
  });

  // ─── Per-user model/provider preferences ─────────────────────────────────
  // GET  /api/user/prefs  — get current user's stored preferences
  // PUT  /api/user/prefs  — save current user's preferences to MongoDB

  app.get("/api/user/prefs", requireAuth, async (req: any, res: any) => {
    const userId: string = req.user?.id || "";
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const col = await getCollection("user_preferences");
      const doc = col ? await (col as any).findOne({ user_id: userId }, { projection: { _id: 0, user_id: 0 } }) : null;
      res.json(doc || {});
    } catch (err: any) {
      res.status(500).json({ error: "Failed to load preferences: " + err.message });
    }
  });

  app.put("/api/user/prefs", requireAuth, async (req: any, res: any) => {
    const userId: string = req.user?.id || "";
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const allowed = ["model", "modelProvider", "searchProvider", "theme", "language"];
    const updates: Record<string, string> = {};
    for (const key of allowed) {
      if (req.body && typeof req.body[key] === "string" && req.body[key].trim()) {
        updates[key] = req.body[key].trim();
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid preference fields. Allowed: " + allowed.join(", ") });
    }
    try {
      const col = await getCollection("user_preferences");
      if (!col) return res.status(503).json({ error: "Database unavailable" });
      await (col as any).updateOne(
        { user_id: userId },
        { $set: { ...updates, user_id: userId, updated_at: new Date() } },
        { upsert: true },
      );
      res.json({ updated: updates });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to save preferences: " + err.message });
    }
  });

  // ─── MCP Config Management API ────────────────────────────────────────────
  // GET  /api/mcp/config  — list all configured MCP servers
  // POST /api/mcp/config  — add or update an MCP server
  // PUT  /api/mcp/config/:name — update a specific MCP server
  // DELETE /api/mcp/config/:name — remove an MCP server

  // MCP config is read from MongoDB directly by the Python MCP manager at tool call time.
  // No runtime reload is needed — changes are reflected immediately on next tool invocation.
  function _reloadMcpServers(): Promise<void> {
    return Promise.resolve();
  }

  app.get("/api/mcp/config", requireAdmin, async (_req: any, res: any) => {
    try {
      const col = await getCollection("mcp_configs");
      if (!col) {
        return res.json({ servers: [] });
      }
      const servers = await (col as any).find({}, { projection: { _id: 0 } }).toArray();
      // Mask auth_token value but include has_auth_token flag so UI can show
      // "token configured" without revealing or accidentally overwriting the real value.
      const masked = servers.map((s: any) => ({
        name: s.name,
        url: s.url,
        description: s.description || "",
        transport: s.transport || "sse",
        enabled: s.enabled !== false,
        has_auth_token: !!s.auth_token,
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
      res.json({ servers: masked });
    } catch (err: any) {
      console.warn("[MCP Config] Failed to list MCP servers:", err.message);
      res.status(500).json({ error: "Failed to list MCP servers" });
    }
  });

  app.post("/api/mcp/config", requireAdmin, async (req: any, res: any) => {
    const { name, url, auth_token, description, transport, enabled } = req.body || {};
    if (!name || !url) {
      return res.status(400).json({ error: "name and url are required" });
    }
    try {
      const col = await getCollection("mcp_configs");
      if (!col) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const doc: Record<string, any> = {
        name: String(name).trim(),
        url: String(url).trim(),
        auth_token: auth_token ? String(auth_token).trim() : "",
        description: description ? String(description).trim() : "",
        transport: transport ? String(transport).trim() : "sse",
        enabled: enabled !== false,
        created_at: new Date(),
        updated_at: new Date(),
      };
      await (col as any).updateOne(
        { name: doc.name },
        { $set: doc },
        { upsert: true },
      );
      console.log(`[MCP Config] Registered MCP server: ${doc.name} → ${doc.url}`);
      _reloadMcpServers().catch(() => {});
      const { auth_token: _t, ...safeDoc } = doc;
      res.status(201).json({ ok: true, server: { ...safeDoc, has_auth_token: !!doc.auth_token } });
    } catch (err: any) {
      console.warn("[MCP Config] Failed to register MCP server:", err.message);
      res.status(500).json({ error: "Failed to register MCP server" });
    }
  });

  app.put("/api/mcp/config/:name", requireAdmin, async (req: any, res: any) => {
    const { name } = req.params;
    const { url, auth_token, description, transport, enabled } = req.body || {};
    try {
      const col = await getCollection("mcp_configs");
      if (!col) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const updates: Record<string, any> = { updated_at: new Date() };
      if (url) updates.url = String(url).trim();
      // Only update auth_token if caller sends a non-empty, non-masked value
      if (auth_token !== undefined && auth_token !== "" && auth_token !== "***") {
        updates.auth_token = String(auth_token).trim();
      }
      // Clear token only if explicitly sent as empty string (not masked)
      if (auth_token === "") {
        updates.auth_token = "";
      }
      if (description !== undefined) updates.description = String(description).trim();
      if (transport !== undefined) updates.transport = String(transport).trim();
      if (enabled !== undefined) updates.enabled = !!enabled;

      const result = await (col as any).updateOne({ name }, { $set: updates });
      if (result.matchedCount === 0) {
        return res.status(404).json({ error: `MCP server '${name}' not found` });
      }
      _reloadMcpServers().catch(() => {});
      res.json({ ok: true, updated: name });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to update MCP server" });
    }
  });

  app.delete("/api/mcp/config/:name", requireAdmin, async (req: any, res: any) => {
    const { name } = req.params;
    try {
      const col = await getCollection("mcp_configs");
      if (!col) {
        return res.status(503).json({ error: "Database unavailable" });
      }
      const result = await (col as any).deleteOne({ name });
      if (result.deletedCount === 0) {
        return res.status(404).json({ error: `MCP server '${name}' not found` });
      }
      console.log(`[MCP Config] Removed MCP server: ${name}`);
      _reloadMcpServers().catch(() => {});
      res.json({ ok: true, deleted: name });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to delete MCP server" });
    }
  });

  // ─── Chat endpoint (Streaming) ───────────────────────────────────────────
  app.post("/api/chat", requireAuth, async (req: any, res: any) => {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const { apiKey, model, hostname, path: apiPath } = getCerebrasConfig();

    if (!apiKey) {
      setupSSEHeaders(res);
      res.write(`data: ${JSON.stringify({ type: "error", error: "API key tidak dikonfigurasi. Set CEREBRAS_API_KEY di environment." })}\n\n`);
      return res.end();
    }

    const requestBody = JSON.stringify({ 
      model, 
      messages, 
      stream: true, 
      max_tokens: 8192,
      temperature: 0.7,
      top_p: 1,
    });
    const options: https.RequestOptions = {
      hostname: hostname,
      port: 443,
      path: apiPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    };

    setupSSEHeaders(res);
    res.flushHeaders(); // Ensure headers are sent immediately

    const apiReq = https.request(options, (apiRes) => {
      if (apiRes.statusCode !== 200) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "AI service error " + apiRes.statusCode })}\n\n`);
        return res.end();
      }

      let buffer = "";
      let messageStarted = false;
      apiRes.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (trimmed.startsWith("data: ")) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const content = parsed.response ?? parsed.choices?.[0]?.delta?.content ?? "";
              if (content) {
                if (!messageStarted) {
                  res.write(`data: ${JSON.stringify({ type: "message_start", role: "assistant" })}\n\n`);
                  messageStarted = true;
                }
                res.write(`data: ${JSON.stringify({ type: "message_chunk", chunk: content })}\n\n`);
                if (typeof (res as any).flush === "function") (res as any).flush();
              }
            } catch (e) {}
          }
        }
      });

      apiRes.on("end", () => {
        res.write(`data: ${JSON.stringify({ type: "message_end" })}\n\n`);
        res.end();
      });
    });

    apiReq.on("error", (err) => {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    });

    apiReq.write(requestBody);
    apiReq.end();
  });

  // ─── Active Agent Sessions (persistence across SSE reconnects) ───────────
  interface AgentSession {
    proc: any;
    eventQueue: string[];
    clients: Set<any>;
    done: boolean;
    startedAt: number;
    stderrBuffer: string;
  }
  const activeAgentSessions = new Map<string, AgentSession>();

  // Clean up sessions older than 30 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [sid, session] of activeAgentSessions.entries()) {
      if (session.done && now - session.startedAt > 30 * 60 * 1000) {
        activeAgentSessions.delete(sid);
      }
    }
  }, 5 * 60 * 1000);

  function _broadcastToSession(session: AgentSession, line: string) {
    const idx = session.eventQueue.length;
    const sid: string = (session as any)._sessionId || "";
    // Emit SSE id: field for live events so clients can track cursor for reconnect.
    // Format: mem:{sid}:{index} — distinct from Redis stream IDs but usable as last_id.
    const sseIdLine = (line.startsWith("data: ") && line !== "data: [DONE]\n\n" && sid)
      ? `id: mem:${sid}:${idx}\n` : "";
    const fullLine = sseIdLine ? `${sseIdLine}${line}` : line;
    session.eventQueue.push(line);
    for (const client of session.clients) {
      try {
        client.write(fullLine);
        if (typeof client.flush === "function") client.flush();
      } catch {}
    }

    // Persist each non-DONE event line to MongoDB session_events + Redis Stream
    if (sid && line !== "data: [DONE]\n\n" && line.startsWith("data: ")) {
      const rawData = line.slice(6).trim();
      if (rawData && rawData !== "[DONE]") {
        let parsedData: any = null;
        try { parsedData = JSON.parse(rawData); } catch {}
        if (parsedData) {
          // MongoDB persistence (for session resume/share page)
          // Python agent is the authoritative Redis Stream publisher; Node only mirrors to MongoDB.
          getCollection("session_events").then((col) => {
            if (!col) {
              console.warn("[session_events] MongoDB not available — session event not persisted");
              return;
            }
            return (col as any).insertOne({
              session_id: sid,
              event_type: parsedData.type || "unknown",
              data: parsedData,
              raw_line: line,
              timestamp: new Date(),
            });
          }).catch((err: any) => {
            console.error("[session_events] MongoDB insert failed:", err?.message);
          });
        }
      }
    }

    // Throttle sync to MongoDB sessions: update every 10 events to avoid write storm
    if ((session as any)._mongoSyncing) return;
    const eventCount = session.eventQueue.length;
    const lastSyncedCount: number = (session as any)._lastSyncedEventCount ?? -1;
    if (eventCount - lastSyncedCount >= 10) {
      (session as any)._mongoSyncing = true;
      (session as any)._lastSyncedEventCount = eventCount;
      if (sid) {
        getCollection("sessions").then((col) => {
          if (!col) return;
          return (col as any).updateOne(
            { session_id: sid },
            { $set: { eventCount, updated_at: new Date() } },
            { upsert: false },
          );
        }).catch(() => {}).finally(() => { (session as any)._mongoSyncing = false; });
      } else {
        (session as any)._mongoSyncing = false;
      }
    }
  }

  // ─── Session list endpoint ────────────────────────────────────────────────
  // Merges in-memory active sessions with MongoDB history
  app.get("/api/sessions", requireAuth, async (_req: any, res: any) => {
    const activeSessions = Array.from(activeAgentSessions.entries()).map(([sid, session]) => ({
      session_id: sid,
      done: session.done,
      startedAt: session.startedAt,
      eventCount: session.eventQueue.length,
      is_running: !session.done,
      source: "active",
    }));

    const activeIds = new Set(activeAgentSessions.keys());
    let historySessions: any[] = [];

    try {
      const col = await getCollection("sessions");
      if (col) {
        const cursor = col.find(
          {},
          { projection: { _id: 0 }, sort: { startedAt: -1 }, limit: 50 } as any,
        );
        const docs = await (cursor as any).toArray();
        historySessions = docs
          .filter((d: any) => !activeIds.has(d.session_id))
          .map((d: any) => ({
            session_id: d.session_id,
            done: d.done ?? true,
            startedAt: d.startedAt,
            eventCount: d.eventCount ?? 0,
            is_running: false,
            source: "history",
            user_message: d.user_message,
          }));
      }
    } catch (err: any) {
      console.warn("[sessions] MongoDB history fetch failed:", err.message);
    }

    res.json({ sessions: [...activeSessions, ...historySessions] });
  });

  // ─── Session sharing (persisted in MongoDB) ────────────────────────────────
  const sharedSessions = new Map<string, boolean>();

  // Load persisted share state from MongoDB on startup
  (async () => {
    try {
      const col = await getCollection("shared_sessions");
      if (col) {
        const docs = await (col as any).find({}, { projection: { _id: 0 } }).toArray();
        for (const doc of docs) {
          if (doc.session_id && typeof doc.is_shared === "boolean") {
            sharedSessions.set(doc.session_id, doc.is_shared);
          }
        }
        console.log(`[share] Loaded ${docs.length} shared sessions from MongoDB.`);
      }
    } catch (err: any) {
      console.warn("[share] Failed to load share state from MongoDB:", err.message);
    }
  })();

  async function persistShareState(sessionId: string, isShared: boolean): Promise<void> {
    try {
      const col = await getCollection("shared_sessions");
      if (col) {
        await (col as any).updateOne(
          { session_id: sessionId },
          { $set: { session_id: sessionId, is_shared: isShared, updated_at: new Date() } },
          { upsert: true },
        );
      }
    } catch (err: any) {
      console.warn("[share] Failed to persist share state to MongoDB:", err.message);
    }
  }

  app.post("/api/sessions/:sessionId/share", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    const { is_shared } = req.body || {};
    sharedSessions.set(sessionId, !!is_shared);
    await persistShareState(sessionId, !!is_shared);
    const shareUrl = `${req.protocol}://${req.get("host")}/share/${sessionId}`;
    res.json({ session_id: sessionId, is_shared: !!is_shared, share_url: !!is_shared ? shareUrl : null });
  });

  app.get("/api/sessions/:sessionId/share", requireAuth, (req: any, res: any) => {
    const { sessionId } = req.params;
    const session = activeAgentSessions.get(sessionId);
    const isShared = sharedSessions.get(sessionId) || false;
    if (!session && !isShared) {
      return res.status(404).json({ error: "Session not found" });
    }
    const shareUrl = `${req.protocol}://${req.get("host")}/share/${sessionId}`;
    res.json({ session_id: sessionId, is_shared: isShared, share_url: isShared ? shareUrl : null });
  });

  app.get("/api/sessions/:sessionId/events", async (req: any, res: any) => {
    const { sessionId } = req.params;
    const isShared = sharedSessions.get(sessionId) || false;
    if (!isShared) return res.status(403).json({ error: "Session is not shared" });

    // Serve from in-memory if session is still active
    const session = activeAgentSessions.get(sessionId);
    if (session) {
      return res.json({ events: session.eventQueue, done: session.done });
    }

    // Serve from MongoDB for historical sessions
    try {
      const col = await getCollection("session_events");
      if (col) {
        const docs = await (col as any)
          .find({ session_id: sessionId }, { projection: { _id: 0 }, sort: { timestamp: 1 } })
          .toArray();
        if (docs.length > 0) {
          const events = docs.map((d: any) => d.raw_line || `data: ${JSON.stringify(d.data)}\n\n`);
          return res.json({ events, done: true });
        }
      }
    } catch (err: any) {
      console.warn("[session_events] MongoDB fetch failed:", err.message);
    }

    // Fall back to Redis XRANGE for sessions that were published to stream but not MongoDB
    try {
      const streamEntries = await redisXRange(`stream:session:${sessionId}`);
      if (streamEntries.length > 0) {
        const events = streamEntries.map((entry) => {
          const raw = entry.fields.data || "";
          return `data: ${raw}\n\n`;
        });
        return res.json({ events, done: true });
      }
    } catch (err: any) {
      console.warn("[session_events] Redis XRANGE fallback failed:", err.message);
    }

    return res.status(404).json({ error: "Session not found" });
  });

  // ─── Public shared session endpoint ──────────────────────────────────────
  // GET /api/shared/:shareToken — fetch a shared session by its share token (public, no auth).
  // shareToken is the sessionId when the session has is_shared=true.
  app.get("/api/shared/:shareToken", async (req: any, res: any) => {
    const { shareToken } = req.params;
    if (!shareToken) return res.status(400).json({ error: "shareToken is required" });

    // Verify the session is actually shared
    const isShared = sharedSessions.get(shareToken) || false;
    if (!isShared) {
      // Check MongoDB in case the in-memory map is stale (e.g., server restart)
      try {
        const col = await getCollection("shared_sessions");
        if (col) {
          const doc = await (col as any).findOne({ session_id: shareToken, is_shared: true });
          if (!doc) return res.status(404).json({ error: "Shared session not found" });
        } else {
          return res.status(404).json({ error: "Shared session not found" });
        }
      } catch {
        return res.status(404).json({ error: "Shared session not found" });
      }
    }

    // Return session events (same logic as /api/sessions/:sessionId/events)
    const session = activeAgentSessions.get(shareToken);
    if (session) {
      return res.json({ session_id: shareToken, events: (session as any).eventQueue || [], done: (session as any).done || false });
    }

    try {
      const col = await getCollection("session_events");
      if (col) {
        const docs = await (col as any)
          .find({ session_id: shareToken }, { projection: { _id: 0 }, sort: { timestamp: 1 } })
          .toArray();
        if (docs.length > 0) {
          const events = docs.map((d: any) => d.raw_line || `data: ${JSON.stringify(d.data)}\n\n`);
          return res.json({ session_id: shareToken, events, done: true });
        }
      }
    } catch (err: any) {
      console.warn("[shared] MongoDB fetch failed:", err.message);
    }

    try {
      const streamEntries = await redisXRange(`stream:session:${shareToken}`);
      if (streamEntries.length > 0) {
        const events = streamEntries.map((entry) => {
          const raw = entry.fields.data || "";
          return `data: ${raw}\n\n`;
        });
        return res.json({ session_id: shareToken, events, done: true });
      }
    } catch (err: any) {
      console.warn("[shared] Redis fallback failed:", err.message);
    }

    return res.status(404).json({ error: "Shared session not found" });
  });

  // ─── Session files endpoint (files tracked in MongoDB session_files) ─────
  app.get("/api/sessions/:sessionId/files", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    const requestingUserId: string = req.user?.id || "";

    // Enforce session ownership (deny-by-default if unverifiable).
    // Check in-memory active sessions first, then MongoDB. Fail closed.
    const liveSession = activeAgentSessions.get(sessionId);
    if (liveSession) {
      // For live sessions, _userId MUST be present (set at session creation).
      // If absent, deny access as a conservative fail-closed measure.
      const sessionOwner: string = (liveSession as any)._userId || "";
      if (!sessionOwner || requestingUserId !== sessionOwner) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else {
      // Session not in memory — look up ownership in MongoDB.
      // Check unified 'sessions' collection first (primary), then legacy 'agent_sessions'.
      let ownerVerified = false;
      try {
        // Primary: sessions collection (unified write path)
        const sessionCol = await getCollection("sessions");
        let sessionDoc: any = null;
        if (sessionCol) {
          sessionDoc = await (sessionCol as any).findOne(
            { session_id: sessionId },
            { projection: { user_id: 1 } },
          );
        }
        // Fallback: agent_sessions collection (legacy write path)
        if (!sessionDoc) {
          const agentSessionCol = await getCollection("agent_sessions");
          if (agentSessionCol) {
            sessionDoc = await (agentSessionCol as any).findOne(
              { session_id: sessionId },
              { projection: { user_id: 1 } },
            );
          }
        }
        if (sessionDoc) {
          const owner: string = sessionDoc.user_id || "";
          if (!owner) {
            // Session record exists but has no user_id (legacy record) — deny access
            return res.status(403).json({ error: "Access denied" });
          }
          if (requestingUserId !== owner) {
            return res.status(403).json({ error: "Access denied" });
          }
          ownerVerified = true;
        }
      } catch (err: any) {
        console.warn("[session_files] Ownership check failed:", err.message);
      }
      if (!ownerVerified) {
        // Session not found in any store — deny access to prevent enumeration
        return res.status(403).json({ error: "Access denied" });
      }
    }

    try {
      const col = await getCollection("session_files");
      if (!col) {
        return res.json({ files: [] });
      }
      const docs = await (col as any)
        .find({ session_id: sessionId }, { projection: { _id: 0 }, sort: { created_at: 1 } })
        .toArray();
      const files = docs.map((d: any) => ({
        name: d.name,
        path: d.path,
        size: d.size,
        mime_type: d.mime_type,
        created_at: d.created_at,
        download_url: d.download_url || "",
      }));
      res.json({ files });
    } catch (err: any) {
      console.warn("[session_files] MongoDB fetch failed:", err.message);
      res.status(500).json({ error: "Failed to fetch session files" });
    }
  });

  // ─── Delete a session ─────────────────────────────────────────────────────
  app.delete("/api/sessions/:sessionId", requireAuth, (req: any, res: any) => {
    const { sessionId } = req.params;
    const session = activeAgentSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (!session.done) {
      try { session.proc.kill("SIGTERM"); } catch {}
      session.done = true;
      _broadcastToSession(session, `data: ${JSON.stringify({ type: "error", error: "Session dihentikan." })}\n\n`);
      _broadcastToSession(session, "data: [DONE]\n\n");
      for (const client of session.clients) { try { client.end(); } catch {} }
    }
    activeAgentSessions.delete(sessionId);
    res.json({ deleted: true, session_id: sessionId });
  });

  // ─── Agent endpoint with SSE ───────────────────────────────────────────────
  app.post("/api/agent", requireAuth, async (req: any, res: any) => {
    const { message, messages, attachments, session_id, resume_from_session, is_continuation } = req.body;
    const userId: string = (req.user && req.user.id) ? req.user.id : "auto-user";
    if (!message && (!messages || !Array.isArray(messages))) {
      return res.status(400).json({ error: "message or messages array is required" });
    }

    setupSSEHeaders(res);
    res.flushHeaders();

    const { apiKey, agentModel } = getCerebrasConfig();

    if (!apiKey) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "API key tidak dikonfigurasi. Set CEREBRAS_API_KEY di environment lalu restart server." })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const sid = session_id || randomUUID();

    // ── Stamp user_id on session creation for ownership tracking ──────────────
    // user_id is in $set (not $setOnInsert) to ensure it's always written even if Python
    // created the session document first without user_id (prevents ownership race).
    getCollection("sessions").then((col) => {
      if (!col) return;
      (col as any).updateOne(
        { session_id: sid },
        {
          $set: { user_id: userId, updated_at: new Date() },
          $setOnInsert: { session_id: sid, created_at: new Date() },
        },
        { upsert: true },
      ).catch(() => {});
    }).catch(() => {});

    // All execution now happens in E2B cloud sandbox — no local VNC needed
    const e2bKey = process.env.E2B_API_KEY || "";
    if (!e2bKey) {
      console.warn("[Agent] E2B_API_KEY not set — sandbox features will be unavailable");
    } else {
      console.log(`[Agent] E2B_API_KEY available (${e2bKey.length} chars) for session ${sid}`);
    }

    // ── Task 1 & 2: Unify sandboxes ───────────────────────────────────────────
    // Determine which E2B sandbox the Python agent should use.
    // Priority: existing running TS session > create new TS sandbox > Python creates its own.
    let dzeckSandboxId = "";
    let preLaunchE2BSessionId = "";
    let preLaunchStreamUrl = "";

    if (e2bKey) {
      // Check if there's an existing running TS sandbox from "Komputer Dzeck"
      const existingSandboxId = getActiveE2BSandboxId();
      if (existingSandboxId) {
        dzeckSandboxId = existingSandboxId;
        console.log(`[Agent] Reusing existing TS sandbox ${dzeckSandboxId} for Python agent`);
      } else {
        // No existing sandbox — create one now so Python uses the same sandbox user sees
        console.log(`[Agent] No active E2B session, creating new sandbox for Python agent...`);
        try {
          const newSession = await createAndRegisterE2BSandbox("https://www.google.com", userId);
          if (newSession) {
            dzeckSandboxId = newSession.sandboxId;
            preLaunchE2BSessionId = newSession.sessionId;
            preLaunchStreamUrl = newSession.streamUrl || "";
            console.log(`[Agent] Created new sandbox ${dzeckSandboxId} (session ${preLaunchE2BSessionId})`);
          }
        } catch (sandboxErr: any) {
          console.warn(`[Agent] Failed to pre-create sandbox: ${sandboxErr.message}. Python will create its own.`);
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const proc = spawn("python3", ["-u", "-m", "server.agent.runner.agent_runner"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: {
        ...process.env,
        CEREBRAS_API_KEY: apiKey,
        CEREBRAS_AGENT_MODEL: agentModel,
        PYTHONPATH: process.cwd(),
        PYTHONUNBUFFERED: "1",
        DZECK_SESSION_ID: sid,
        DZECK_USER_ID: userId || "",
        E2B_API_KEY: e2bKey,
        ...(dzeckSandboxId ? { DZECK_E2B_SANDBOX_ID: dzeckSandboxId } : {}),
        // If Python will create its own sandbox (no pre-existing sandbox ID), mark ownership
        // so _cleanup_e2b_sandbox() runs at agent exit and prevents sandbox leaks.
        ...(!dzeckSandboxId ? { DZECK_AGENT_OWNS_SANDBOX: "1" } : {}),
      },
    });

    // ── Task 5: Session Resume — load full chat_history + plan from MongoDB ──
    let resumeData: any = null;
    if (resume_from_session) {
      try {
        // ── Primary: sessions collection (used by SessionService / SessionStore) ──
        // Ownership enforced: filter by both session_id AND user_id (prevents IDOR).
        const sessionsCol = await getCollection("sessions");
        if (sessionsCol) {
          const sessionDoc = await (sessionsCol as any).findOne(
            { session_id: resume_from_session, user_id: userId },
            { projection: { _id: 0 } },
          );
          if (sessionDoc) {
            resumeData = {
              chat_history: sessionDoc.chat_history || [],
              plan: sessionDoc.plan || null,
              user_message: sessionDoc.user_message || "",
            };
            console.log(
              `[Agent] Loaded resume_data from sessions for ${resume_from_session} (user ${userId}): ` +
              `${resumeData.chat_history.length} messages, plan=${!!resumeData.plan}`,
            );
          }
        }
        // ── Fallback: agent_sessions (legacy collection used in older write paths) ──
        if (!resumeData) {
          const agentSessCol = await getCollection("agent_sessions");
          if (agentSessCol) {
            const legacyDoc = await (agentSessCol as any).findOne(
              { session_id: resume_from_session, user_id: userId },
              { projection: { _id: 0 } },
            );
            if (legacyDoc) {
              resumeData = {
                chat_history: legacyDoc.chat_history || [],
                plan: legacyDoc.plan || null,
                user_message: legacyDoc.user_message || "",
              };
              console.log(
                `[Agent] Loaded resume_data from agent_sessions (legacy) for ${resume_from_session} (user ${userId})`,
              );
            }
          }
        }
        if (!resumeData) {
          console.warn(
            `[Agent] resume_from_session ${resume_from_session} not found for user ${userId} — ignoring resume`,
          );
        }
      } catch (resumeErr: any) {
        console.warn(`[Agent] Failed to load resume_data for ${resume_from_session}:`, resumeErr.message);
      }
    }

    // Only pass resume_from_session to Python if ownership was verified in Node.js.
    // If resumeData is null (session not found for this user), suppress the session ID
    // to prevent Python's SessionService.resume_session() from loading another user's state.
    const verifiedResumeSession = (resume_from_session && resumeData) ? resume_from_session : null;

    proc.stdin.write(JSON.stringify({
      message: message || "",
      messages: messages || [],
      model: agentModel,
      attachments: attachments || [],
      session_id: sid,
      user_id: userId,
      resume_from_session: verifiedResumeSession,
      resume_data: resumeData,
      is_continuation: is_continuation || false,
    }));
    proc.stdin.end();

    const sessionStartedAt = Date.now();
    const session: AgentSession = {
      proc,
      eventQueue: [],
      clients: new Set([res]),
      done: false,
      startedAt: sessionStartedAt,
      stderrBuffer: "",
    };
    (session as any)._sessionId = sid;
    (session as any)._sandboxId = dzeckSandboxId || null;
    activeAgentSessions.set(sid, session);

    // Sync new session to MongoDB sessions collection (unified)
    const sessionUserId: string = req.user?.id || "unknown";
    (session as any)._userId = sessionUserId;

    // Link agent session to E2B desktop sandbox for pause/resume correlation
    if (dzeckSandboxId) {
      linkAgentSessionToSandbox(sid, dzeckSandboxId, sessionUserId);
    }
    (async () => {
      try {
        const col = await getCollection("sessions");
        if (col) {
          await (col as any).updateOne(
            { session_id: sid },
            {
              $set: {
                user_id: sessionUserId,
                done: false,
                startedAt: sessionStartedAt,
                eventCount: 0,
                is_running: true,
                user_message: message || (messages && messages.length > 0 ? messages[messages.length - 1]?.content : ""),
                updated_at: new Date(),
              },
              $setOnInsert: {
                session_id: sid,
                created_at: new Date(),
              },
            },
            { upsert: true },
          );
        }
      } catch (err: any) {
        console.warn("[sessions] Failed to sync new session to MongoDB:", err.message);
      }
    })();

    const sessionLine = `data: ${JSON.stringify({ type: "session", session_id: sid, e2b_enabled: isE2BEnabled() })}\n\n`;
    _broadcastToSession(session, sessionLine);

    // If we pre-created a sandbox before spawning Python, emit a vnc_stream_url event
    // immediately so the frontend switches to that sandbox's VNC view right away.
    if (preLaunchE2BSessionId && preLaunchStreamUrl) {
      const vncEvent = {
        type: "vnc_stream_url",
        vnc_url: preLaunchStreamUrl,
        sandbox_id: dzeckSandboxId,
        e2b_session_id: preLaunchE2BSessionId,
      };
      _broadcastToSession(session, `data: ${JSON.stringify(vncEvent)}\n\n`);
      console.log(`[Agent] Emitted pre-launch vnc_stream_url for session ${preLaunchE2BSessionId}`);
    }

    let buf = "";

    function _processAgentLine(line: string) {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "done") {
          session.done = true;
          _broadcastToSession(session, "data: [DONE]\n\n");
          for (const client of session.clients) { try { client.end(); } catch {} }
        } else {
          if (parsed.type === "vnc_stream_url" && parsed.vnc_url) {
            console.log(`[Agent] VNC stream URL received from Python sandbox: ${parsed.vnc_url}`);
            if (parsed.sandbox_id) {
              // Bind sandbox to this session for safe takeover resolution
              if (!(session as any)._sandboxId) {
                (session as any)._sandboxId = parsed.sandbox_id;
              }
              const _agentSidForLink: string = (session as any)._sessionId || sid;
              const _agentUserIdForLink: string = (session as any)._userId || "";
              registerExternalE2BSandbox(parsed.sandbox_id, parsed.vnc_url)
                .then((result) => {
                  console.log(`[Agent] Auto-registered agent sandbox as e2b-desktop session: ${result.sessionId}`);
                  // Link this agent session to the E2B desktop session so pause/resume works
                  linkAgentSessionToSandbox(_agentSidForLink, parsed.sandbox_id, _agentUserIdForLink);
                  const enriched = { ...parsed, e2b_session_id: result.sessionId };
                  _broadcastToSession(session, `data: ${JSON.stringify(enriched)}\n\n`);
                })
                .catch((err: any) => {
                  console.warn(`[Agent] registerExternalE2BSandbox failed: ${err.message}. Forwarding original event.`);
                  _broadcastToSession(session, `data: ${JSON.stringify(parsed)}\n\n`);
                });
            } else {
              _broadcastToSession(session, `data: ${JSON.stringify(parsed)}\n\n`);
            }
          } else {
            _broadcastToSession(session, `data: ${JSON.stringify(parsed)}\n\n`);
          }
        }
      } catch (parseErr) {
        console.error("[SSE parse error] Failed to parse line:", line.substring(0, 200), parseErr);
      }
    }

    proc.stdout.on("data", (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        _processAgentLine(line);
      }
    });

    proc.stdout.on("end", () => {
      // Process any remaining fragment that didn't end with newline
      if (buf.trim()) {
        _processAgentLine(buf);
        buf = "";
      }
    });

    proc.stderr.on("data", (data: Buffer) => {
      session.stderrBuffer += data.toString();
      console.error("[Agent stderr]:", data.toString());
    });

    proc.on("error", (err: Error) => {
      console.error("[Agent] Failed to spawn Python agent:", err.message);
      session.done = true;
      const errLine = `data: ${JSON.stringify({ type: "error", error: "Python agent tidak tersedia. Pastikan Python terinstall." })}\n\n`;
      _broadcastToSession(session, errLine);
      _broadcastToSession(session, "data: [DONE]\n\n");
      for (const client of session.clients) { try { client.end(); } catch {} }
    });

    const BENIGN = [/redis/i, /mongodb/i, /motor/i, /DNS/i, /Name or service not known/i,
      /ConnectionRefusedError/i, /\[CacheStore\]/i, /\[SessionStore\]/i, /\[SessionService\]/i,
      /WARNING:/i, /DeprecationWarning/i, /connection failed/i, /Traceback/i,
      /aioredis/i, /pymongo/i, /socket\.gaierror/i, /\[agent\]/i,
      /Config push failed/i, /fork\/exec/i, /permission denied/i,
      /\[E2B\]/i, /\[E2B-Desktop\]/i, /\[Browser\]/i, /Authentication required/i,
      /MONGODB_URI not set/i, /sessions will be in-memory/i,
      /Sandbox health check/i, /sandbox creation failed/i,
      /\[RedisStreamQueue\]/i, /Rate limited.*retrying/i];

    proc.on("close", (code: number | null) => {
      if (!session.done) {
        if (code !== 0 && session.stderrBuffer) {
          const hasRealError = !BENIGN.some(p => p.test(session.stderrBuffer));
          if (hasRealError) {
            _broadcastToSession(session, `data: ${JSON.stringify({ type: "error", error: "Agen mengalami kesalahan internal. Silakan coba lagi." })}\n\n`);
          }
        }
        session.done = true;
        _broadcastToSession(session, "data: [DONE]\n\n");
        for (const client of session.clients) { try { client.end(); } catch {} }
      }
      if (code !== 0) console.error(`Agent process exited with code ${code}. Stderr: ${session.stderrBuffer.slice(-500)}`);

      // Sync completed session to MongoDB sessions collection + cleanup Redis stream after 24h
      (async () => {
        try {
          const col = await getCollection("sessions");
          if (col) {
            await (col as any).updateOne(
              { session_id: sid },
              {
                $set: {
                  done: true,
                  is_running: false,
                  eventCount: session.eventQueue.length,
                  updated_at: new Date(),
                },
              },
              { upsert: false },
            );
          }
        } catch (err: any) {
          console.warn("[sessions] Failed to sync session completion to MongoDB:", err.message);
        }
        // Set a 24-hour expiry on the Redis stream so it self-cleans after events are replayed
        try {
          const rc = getRedisClient();
          if (rc) {
            await (rc as any).expire(`stream:session:${sid}`, 86400);
          }
        } catch {}
        // Also clear any stale pause key left over from a crashed takeover
        try {
          await redisDel(`agent:${sid}:paused`);
        } catch {}
      })();
    });

    res.on("close", () => { session.clients.delete(res); });
  });

  // ─── Reconnect to existing agent session ──────────────────────────────────
  // Replay uses Redis XRANGE as primary durable log, with in-memory fallback.
  app.get("/api/agent/stream/:sid", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const replay = req.query.replay === "true";
    const lastId: string = (req.query.last_id as string) || "0";
    const requestingUserIdStream: string = req.user?.id || "";

    const session = activeAgentSessions.get(sid);
    if (!session) {
      // Allow historical replay via MongoDB ownership check
      let histVerified = false;
      try {
        const hc = await getCollection("sessions");
        if (hc) {
          const hd = await (hc as any).findOne({ session_id: sid }, { projection: { user_id: 1 } });
          if (hd) {
            const ho: string = hd.user_id || "";
            if (ho && requestingUserIdStream === ho) histVerified = true;
          }
        }
      } catch {}
      if (!histVerified) {
        return res.status(404).json({ error: "Session not found or expired" });
      }
      // Session is done — fall through to XRANGE replay below with an empty session shell
      // (no active session to add client to, so just replay events and close)
      // mem: cursors are in-memory only and cannot be applied to Redis XRANGE; normalize to "0"
      const redisReplayCursor = lastId.startsWith("mem:") ? "0" : lastId;
      setupSSEHeaders(res);
      try {
        const streamEntries = await redisXRange(`stream:session:${sid}`, redisReplayCursor);
        for (const entry of streamEntries) {
          const raw = entry.fields.data || "";
          if (raw) {
            try { res.write(`id: ${entry.id}\ndata: ${raw}\n\n`); } catch {}
          }
        }
      } catch {}
      try { res.write("data: [DONE]\n\n"); res.end(); } catch {}
      return;
    }

    // Live session — enforce ownership
    const streamOwner: string = (session as any)._userId || "";
    if (!streamOwner || requestingUserIdStream !== streamOwner) {
      return res.status(403).json({ error: "Access denied" });
    }

    setupSSEHeaders(res);
    session.clients.add(res);

    if (replay) {
      // Attempt Redis XRANGE replay first (durable log), fall back to in-memory.
      // Emit SSE id: field with entry ID so client can resume from last seen.
      let replayed = false;
      if (!lastId.startsWith("mem:")) {
        // Attempt Redis replay for Redis stream IDs
        try {
          const streamEntries = await redisXRange(`stream:session:${sid}`, lastId);
          if (streamEntries.length > 0) {
            replayed = true;
            for (const entry of streamEntries) {
              const raw = entry.fields.data || "";
              if (raw) {
                try {
                  res.write(`id: ${entry.id}\ndata: ${raw}\n\n`);
                } catch {}
              }
            }
          }
        } catch (streamErr: any) {
          console.warn("[stream] Redis XRANGE replay failed:", streamErr.message);
        }
      }
      if (!replayed) {
        // In-memory fallback: parse mem:sid:index cursor if present
        let startIdx = 0;
        if (lastId.startsWith("mem:")) {
          const parts = lastId.split(":");
          const parsedIdx = parseInt(parts[2] || "0", 10);
          if (!isNaN(parsedIdx)) startIdx = parsedIdx + 1;
        }
        const queueSlice = session.eventQueue.slice(startIdx);
        for (let i = 0; i < queueSlice.length; i++) {
          const eventIdx = startIdx + i;
          const line = queueSlice[i];
          const idPrefix = (line.startsWith("data: ") && line !== "data: [DONE]\n\n")
            ? `id: mem:${sid}:${eventIdx}\n` : "";
          try { res.write(`${idPrefix}${line}`); } catch {}
        }
      }
    }
    if (session.done) {
      try { res.write("data: [DONE]\n\n"); res.end(); } catch {}
    }
    res.on("close", () => { session.clients.delete(res); });
  });

  // ─── Redis-Stream SSE consumer endpoint ───────────────────────────────────
  // Reads events from Redis Stream via XREAD cursor for SSE delivery.
  // This is the stream-first consumer path when Redis is available.
  // Client sends ?last_id=<last-seen-stream-id> (default "0" = from start).
  app.get("/api/agent/stream-redis/:sid", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const lastId: string = (req.query.last_id as string) || "0";
    const requestingUserId: string = req.user?.id || "";
    const streamKey = `stream:session:${sid}`;

    // Enforce session ownership before streaming (same deny-by-default logic as /files)
    const liveForStream = activeAgentSessions.get(sid);
    if (liveForStream) {
      const streamOwner: string = (liveForStream as any)._userId || "";
      if (!streamOwner || requestingUserId !== streamOwner) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else {
      let streamVerified = false;
      try {
        const sc = await getCollection("sessions");
        if (sc) {
          const sd = await (sc as any).findOne({ session_id: sid }, { projection: { user_id: 1 } });
          if (sd) {
            const o: string = sd.user_id || "";
            if (!o || requestingUserId !== o) {
              return res.status(403).json({ error: "Access denied" });
            }
            streamVerified = true;
          }
        }
      } catch {}
      if (!streamVerified) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    setupSSEHeaders(res);

    // Poll Redis XREAD in a loop until session done or client disconnects
    let cursor = lastId;
    let closed = false;
    res.on("close", () => { closed = true; });

    // Send any already-available events via XRANGE first (catch-up)
    // Each event is prefixed with an SSE `id:` line so the client can track
    // the cursor and pass it back as `?last_id=` on reconnect.
    try {
      const catchUp = await redisXRange(streamKey, cursor);
      for (const entry of catchUp) {
        const raw = entry.fields.data || "";
        if (raw) {
          try { res.write(`id: ${entry.id}\ndata: ${raw}\n\n`); } catch {}
          cursor = entry.id;
        }
      }
    } catch {}

    // Poll for new events
    const pollInterval = 500;
    const maxWaitMs = 30 * 60 * 1000;
    const started = Date.now();

    while (!closed && Date.now() - started < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      if (closed) break;
      try {
        const entries = await redisXRead(streamKey, cursor);
        for (const entry of entries) {
          const raw = entry.fields.data || "";
          if (raw) {
            try { res.write(`id: ${entry.id}\ndata: ${raw}\n\n`); } catch {}
            cursor = entry.id;
          }
        }
        // Check if session is done (done event emitted)
        const session = activeAgentSessions.get(sid);
        if (session?.done) {
          try { res.write("data: [DONE]\n\n"); } catch {}
          break;
        }
        if (!session && entries.length === 0) break; // Session completed and cleaned up
      } catch {}
    }
    try { res.end(); } catch {}
  });

  // ─── Agent session status endpoint ────────────────────────────────────────
  app.get("/api/agent/status/:sid", (req: any, res: any) => {
    const { sid } = req.params;
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.json({ exists: false });
    }
    res.json({
      exists: true,
      done: session.done,
      eventCount: session.eventQueue.length,
      clients: session.clients.size,
    });
  });

  // ─── Stop an active agent session ─────────────────────────────────────────
  app.post("/api/agent/stop/:sid", requireAuth, (req: any, res: any) => {
    const { sid } = req.params;
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.json({ stopped: false, reason: "not_found" });
    }
    if (!session.done) {
      try { session.proc.kill("SIGTERM"); } catch {}
      session.done = true;
      _broadcastToSession(session, `data: ${JSON.stringify({ type: "error", error: "Agen dihentikan oleh pengguna." })}\n\n`);
      _broadcastToSession(session, "data: [DONE]\n\n");
      for (const client of session.clients) { try { client.end(); } catch {} }
    }
    res.json({ stopped: true });
  });

  // ─── Takeover: Pause agent for a session (set Redis key) ─────────────────
  app.post("/api/agent/sessions/:sid/pause", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const owner: string = (session as any)._userId || "";
    const requestingUser: string = req.user?.id || "";
    if (owner && requestingUser !== owner) {
      return res.status(403).json({ error: "Access denied" });
    }
    const key = `agent:${sid}:paused`;
    const ok = await redisSet(key, "1", 600);
    console.log(`[Takeover] Session ${sid} paused (Redis ${ok ? "ok — agent will pause before next tool call" : "unavailable — pause may not propagate to Python agent"})`);
    (session as any)._paused = true;
    _broadcastToSession(session, `data: ${JSON.stringify({ type: "notify", content: "Agent dijeda untuk takeover mode." })}\n\n`);
    res.json({ paused: true, session_id: sid });
  });

  // ─── Takeover: Resume agent for a session (clear Redis key) ──────────────
  app.post("/api/agent/sessions/:sid/resume", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const owner: string = (session as any)._userId || "";
    const requestingUser: string = req.user?.id || "";
    if (owner && requestingUser !== owner) {
      return res.status(403).json({ error: "Access denied" });
    }
    const key = `agent:${sid}:paused`;
    await redisDel(key);
    (session as any)._paused = false;
    console.log(`[Takeover] Session ${sid} resumed`);
    _broadcastToSession(session, `data: ${JSON.stringify({ type: "notify", content: "Agent dilanjutkan." })}\n\n`);
    res.json({ resumed: true, session_id: sid });
  });

  // ─── Pause/Resume aliases at /api/sessions/:sid/ (mirrors /api/agent/sessions/:sid/) ──
  // TakeOverView.tsx and mobile frontend call these canonical paths.
  app.post("/api/sessions/:sid/pause", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const owner: string = (session as any)._userId || "";
    const requestingUser: string = req.user?.id || "";
    if (owner && requestingUser !== owner) {
      return res.status(403).json({ error: "Access denied" });
    }
    const key = `agent:${sid}:paused`;
    const ok = await redisSet(key, "1", 600);
    console.log(`[Takeover] Session ${sid} paused (Redis ${ok ? "ok" : "unavailable"})`);
    (session as any)._paused = true;
    _broadcastToSession(session, `data: ${JSON.stringify({ type: "notify", content: "Agent dijeda untuk takeover mode." })}\n\n`);
    res.json({ paused: true, session_id: sid });
  });

  app.post("/api/sessions/:sid/resume", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const owner: string = (session as any)._userId || "";
    const requestingUser: string = req.user?.id || "";
    if (owner && requestingUser !== owner) {
      return res.status(403).json({ error: "Access denied" });
    }
    const key = `agent:${sid}:paused`;
    await redisDel(key);
    (session as any)._paused = false;
    console.log(`[Takeover] Session ${sid} resumed`);
    _broadcastToSession(session, `data: ${JSON.stringify({ type: "notify", content: "Agent dilanjutkan." })}\n\n`);
    res.json({ resumed: true, session_id: sid });
  });

  // ─── Stop agent via Redis stop signal (graceful stop via plan_act.py loop) ──
  // POST /api/sessions/:id/stop → sets Redis key agent:{id}:stop = "1"
  // plan_act.py checks this key in the execution loop and breaks cleanly.
  app.post("/api/sessions/:sid/stop", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const requestingUser: string = req.user?.id || "";

    const session = activeAgentSessions.get(sid);
    if (session) {
      const owner: string = (session as any)._userId || "";
      if (owner && requestingUser !== owner) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    // Set Redis stop signal so plan_act.py loop breaks gracefully
    const stopKey = `agent:${sid}:stop`;
    await redisSet(stopKey, "1", 600);
    console.log(`[Stop] Session ${sid} — Redis stop signal set.`);

    if (session && !session.done) {
      _broadcastToSession(session, `data: ${JSON.stringify({ type: "notify", content: "Agent dihentikan oleh pengguna." })}\n\n`);
    }

    // Self-clean the stop key after 10 minutes (cleanup is also done in Python)
    setTimeout(async () => {
      try { await redisDel(stopKey); } catch {}
    }, 600_000);

    res.json({ stopped: true, session_id: sid });
  });

  // ─── Takeover: pause agent and return active VNC URL ─────────────────────
  // POST /api/sessions/:id/takeover
  // Sets Redis pause key, then returns the VNC stream URL so the client can connect.
  app.post("/api/sessions/:sid/takeover", requireAuth, async (req: any, res: any) => {
    const { sid } = req.params;
    const requestingUser: string = req.user?.id || "";

    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    const owner: string = (session as any)._userId || "";
    if (owner && requestingUser !== owner) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Pause the agent
    const pauseKey = `agent:${sid}:paused`;
    await redisSet(pauseKey, "1", 600);
    (session as any)._paused = true;
    console.log(`[Takeover] Session ${sid} paused for takeover.`);
    _broadcastToSession(session, `data: ${JSON.stringify({ type: "notify", content: "Agent dijeda untuk takeover mode." })}\n\n`);

    // Resolve VNC URL and E2B desktop session ID from the per-session sandbox binding.
    // ONLY use _sandboxId bound to this specific session — never fall back to a global
    // active sandbox to prevent cross-session VNC exposure.
    const agentSandboxId: string = (session as any)._sandboxId || "";
    let vncUrl: string | null = null;
    let e2bSessionId: string | null = null;
    if (agentSandboxId) {
      const e2bSess = getSessionBySandboxId(agentSandboxId);
      vncUrl = e2bSess?.streamUrl || e2bSess?.vncUrl || null;
      e2bSessionId = e2bSess?.id || null;
    }

    res.json({
      paused: true,
      session_id: sid,
      vnc_url: vncUrl,
      e2b_session_id: e2bSessionId,
      sandbox_id: agentSandboxId || null,
      message: "Agent paused. Connect to VNC to take over control.",
    });
  });

  // ─── GridFS session files list ─────────────────────────────────────────────
  // GET /api/sessions/:sessionId/gridfs-files → list GridFS files for session
  app.get("/api/sessions/:sessionId/gridfs-files", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    const requestingUserId: string = req.user?.id || "";

    // Enforce session ownership — check both live map and MongoDB for inactive sessions
    const liveSession = activeAgentSessions.get(sessionId);
    if (liveSession) {
      const sessionOwner: string = (liveSession as any)._userId || "";
      if (sessionOwner && requestingUserId !== sessionOwner) {
        return res.status(403).json({ error: "Access denied" });
      }
    } else {
      // Session not in memory — query MongoDB to verify ownership.
      // Fail closed: if we cannot verify ownership, return 403.
      try {
        const db = await getMongoDb();
        if (!db) {
          return res.status(503).json({ error: "Database unavailable" });
        }
        const sessDoc = await db.collection("sessions").findOne(
          { session_id: sessionId },
          { projection: { user_id: 1 } }
        );
        if (!sessDoc) {
          return res.status(404).json({ error: "Session not found" });
        }
        if (sessDoc.user_id && sessDoc.user_id !== requestingUserId) {
          return res.status(403).json({ error: "Access denied" });
        }
      } catch {
        // If MongoDB check throws unexpectedly, fail closed
        return res.status(403).json({ error: "Unable to verify session ownership" });
      }
    }

    try {
      const result = await new Promise<{ ok: boolean; files?: any[]; error?: string }>((resolve) => {
        const py = spawn("python3", ["-c", `
import sys, json, asyncio, os
session_id = sys.argv[1]
async def main():
    try:
        from server.agent.db.gridfs import list_files
        files = await list_files(session_id)
        print(json.dumps({"ok": True, "files": [f.to_dict() for f in files]}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
asyncio.run(main())
`, sessionId], {
          env: { ...process.env },
          cwd: process.cwd(),
          timeout: 15000,
        });
        let out = "";
        py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        py.on("close", () => {
          try {
            const parsed = JSON.parse(out.trim());
            resolve(parsed);
          } catch {
            resolve({ ok: false, error: "parse error" });
          }
        });
        py.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
      });

      if (!result.ok) {
        return res.status(500).json({ error: result.error || "Failed to list GridFS files" });
      }
      const files = (result.files || []).map((f: any) => ({
        ...f,
        download_url: `/api/files/${f.file_id}`,
      }));
      res.json({ files });
    } catch (err: any) {
      res.status(500).json({ error: "Failed to list session files" });
    }
  });

  // ─── Todo list endpoint (read todo for a session) ─────────────────────────
  app.get("/api/sessions/:sessionId/todos", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    try {
      const col = await getCollection("agent_todos");
      if (!col) {
        return res.json({ exists: false, items: [], title: "Todo List" });
      }
      const doc = await (col as any).findOne({ session_id: sessionId }, { projection: { _id: 0 } });
      if (!doc) {
        return res.json({ exists: false, items: [], title: "Todo List" });
      }
      res.json({
        exists: true,
        title: doc.title || "Todo List",
        items: doc.items || [],
        updated_at: doc.updated_at,
      });
    } catch (err: any) {
      console.warn("[todos] Failed to fetch todos:", err.message);
      res.status(500).json({ error: "Failed to fetch todos" });
    }
  });

  // ─── Task list endpoint (read tasks for a session) ─────────────────────────
  app.get("/api/sessions/:sessionId/tasks", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    try {
      const col = await getCollection("agent_tasks");
      if (!col) {
        return res.json({ tasks: [] });
      }
      const tasks = await (col as any).find(
        { session_id: sessionId },
        { projection: { _id: 0 }, sort: { created_at: 1 } }
      ).toArray();
      res.json({ tasks });
    } catch (err: any) {
      console.warn("[tasks] Failed to fetch tasks:", err.message);
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.get("/api/test", (_req: any, res: any) => {
    res.json({
      message: "API is working",
      timestamp: new Date().toISOString(),
      cerebrasConfigured: !!startupCfg.apiKey,
      e2bEnabled: isE2BEnabled(),
    });
  });

  // ─── One-time download tokens (TTL = 5 min, in-memory) ──────────────────────
  // Allows file downloads without Bearer headers (e.g. Linking.openURL in APK).
  // POST /api/files/one-time-token  { download_url } → { token, url }
  // GET  /api/files/download?token=xxx  — no auth header required

  interface OneTimeToken {
    /** Canonical file path in the sandbox (decoded) */
    filePath: string;
    /** Sandbox ID (may be empty string) */
    sandboxId: string;
    /** Filename for Content-Disposition */
    fileName: string;
    expiresAt: number;
  }
  const _oneTimeTokens = new Map<string, OneTimeToken>();

  // Cleanup expired tokens every 10 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [tok, val] of _oneTimeTokens.entries()) {
      if (val.expiresAt < now) _oneTimeTokens.delete(tok);
    }
  }, 10 * 60 * 1000);

  app.post("/api/files/one-time-token", requireAuth, (req: any, res: any) => {
    const { download_url } = req.body || {};
    if (!download_url || typeof download_url !== "string") {
      return res.status(400).json({ error: "download_url is required" });
    }
    // Parse the download_url to extract path, sandbox_id, and name/filename
    // so the token is scoped to the exact resource being requested.
    const base = `${req.protocol}://${req.get("host")}`;
    let parsed: URL;
    try {
      parsed = new URL(download_url, base);
    } catch {
      return res.status(400).json({ error: "download_url is invalid" });
    }
    const rawFilePath = parsed.searchParams.get("path") || "";
    if (!rawFilePath) {
      return res.status(400).json({ error: "download_url must include a path parameter" });
    }
    let filePath: string;
    try {
      filePath = decodeURIComponent(rawFilePath);
    } catch {
      return res.status(400).json({ error: "invalid path encoding in download_url" });
    }
    if (filePath.includes("..")) {
      return res.status(400).json({ error: "path not allowed" });
    }
    const sandboxId = parsed.searchParams.get("sandbox_id") || "";
    const rawName = parsed.searchParams.get("name") || parsed.searchParams.get("filename") || "";
    let fileName = path.basename(filePath);
    if (rawName) {
      try { fileName = decodeURIComponent(rawName); } catch { /* keep basename fallback */ }
    }

    const token = randomUUID();
    _oneTimeTokens.set(token, {
      filePath,
      sandboxId,
      fileName,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    // Build the tokenized URL pointing to /api/files/download with resource params
    const targetUrl = new URL("/api/files/download", base);
    targetUrl.searchParams.set("path", rawFilePath);
    if (sandboxId) targetUrl.searchParams.set("sandbox_id", sandboxId);
    if (rawName) targetUrl.searchParams.set("name", rawName);
    targetUrl.searchParams.set("token", token);

    res.json({ token, url: targetUrl.href });
  });

  // ─── File Download endpoint ─────────────────────────────────────────────────
  // Proxies file directly from E2B sandbox — no local disk copy.
  // Required: ?sandbox_id=xxx OR an active sandbox; ?path=/home/user/...&name=file.ext
  // Also accepts ?token=xxx for one-time token-based downloads (no Bearer header needed).
  //
  // Auth gate middleware: passes through if ?token= is valid, otherwise delegates
  // to standard requireAuth (Bearer token). This separates auth from business logic.
  const _fileDownloadAuthGate = (req: any, res: any, next: any) => {
    const otToken = req.query.token as string | undefined;
    if (!otToken) {
      // No one-time token — use standard Bearer auth
      return requireAuth(req, res, next);
    }
    // One-time token path: validate + bind to resource, consume on success
    const entry = _oneTimeTokens.get(otToken);
    if (!entry || entry.expiresAt < Date.now()) {
      _oneTimeTokens.delete(otToken);
      return res.status(401).json({ error: "Token tidak valid atau sudah kadaluarsa" });
    }
    let reqFilePath = "";
    try { reqFilePath = decodeURIComponent((req.query.path as string) || ""); } catch {}
    const reqSandboxId = (req.query.sandbox_id as string) || "";
    if (reqFilePath !== entry.filePath || reqSandboxId !== entry.sandboxId) {
      // Do NOT consume — caller gets a clear error, token remains intact for inspection
      return res.status(403).json({ error: "Token tidak cocok dengan resource yang diminta" });
    }
    // Valid and matching — consume (one-time use) then proceed
    _oneTimeTokens.delete(otToken);
    next();
  };

  app.get("/api/files/download", _fileDownloadAuthGate, async (req: any, res: any) => {
    const rawPath = req.query.path as string;
    const rawName = req.query.name as string;
    const rawSandboxId = req.query.sandbox_id as string | undefined;

    if (!rawPath) {
      return res.status(400).json({ error: "path is required" });
    }

    let filePath: string;
    try {
      filePath = decodeURIComponent(rawPath);
    } catch {
      return res.status(400).json({ error: "invalid path encoding" });
    }

    if (filePath.includes("..")) {
      return res.status(403).json({ error: "access denied: path not allowed" });
    }

    const fileName = rawName ? decodeURIComponent(rawName) : path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase().slice(1);

    const MIME: Record<string, string> = {
      zip: "application/zip", rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed", tar: "application/x-tar",
      gz: "application/gzip", bz2: "application/x-bzip2", xz: "application/x-xz",
      iso: "application/x-iso9660-image",
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      odt: "application/vnd.oasis.opendocument.text",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      txt: "text/plain", md: "text/markdown", rtf: "application/rtf",
      csv: "text/csv", tsv: "text/tab-separated-values",
      json: "application/json", xml: "application/xml",
      yaml: "application/x-yaml", yml: "application/x-yaml",
      toml: "application/toml", ini: "text/plain",
      sql: "application/sql", db: "application/x-sqlite3",
      sqlite: "application/x-sqlite3", sqlite3: "application/x-sqlite3",
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", bmp: "image/bmp", webp: "image/webp",
      svg: "image/svg+xml", ico: "image/x-icon",
      mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo",
      mov: "video/quicktime", webm: "video/webm", flv: "video/x-flv",
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
      aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4",
      py: "text/x-python", js: "text/javascript", ts: "text/typescript",
      tsx: "text/typescript", jsx: "text/javascript", html: "text/html",
      htm: "text/html", css: "text/css", sh: "text/x-shellscript",
      bash: "text/x-shellscript", java: "text/x-java-source",
      cpp: "text/x-c", c: "text/x-c", go: "text/x-go",
      rs: "text/x-rust", rb: "text/x-ruby", php: "text/x-php",
      exe: "application/x-msdownload", msi: "application/x-msinstaller",
      apk: "application/vnd.android.package-archive",
      deb: "application/x-debian-package", rpm: "application/x-rpm",
      wasm: "application/wasm",
    };

    const mimeType = MIME[ext] || "application/octet-stream";

    // ── Mode 1: E2B proxy — stream file directly from E2B sandbox ─────────────
    // sandbox_id in query takes priority; fall back to active sandbox
    const sandboxId = rawSandboxId || getActiveE2BSandboxId();
    if (sandboxId && process.env.E2B_API_KEY) {
      try {
        console.log(`[FileDownload] E2B proxy: sandbox=${sandboxId} path=${filePath} name=${fileName}`);

        // Stream file from E2B sandbox via Python subprocess:
        // Python writes base64-encoded file to stdout; we chunk-decode it here.
        const streamed = await new Promise<boolean>((resolve, reject) => {
          const py = spawn("python3", ["-c", `
import sys, base64, os
e2b_key = os.environ.get("E2B_API_KEY", "")
sandbox_id = sys.argv[1]
file_path = sys.argv[2]
try:
    from e2b_desktop import Sandbox
    sb = Sandbox.connect(sandbox_id, api_key=e2b_key)
    data = sb.files.read(file_path, format="bytes")
    if data is None:
        data = b""
    if isinstance(data, (bytes, bytearray)):
        raw = bytes(data)
    elif isinstance(data, str):
        raw = data.encode("utf-8", errors="replace")
    else:
        raw = bytes(data)
    sys.stdout.buffer.write(base64.b64encode(raw))
    sys.stdout.buffer.flush()
except Exception as ex:
    sys.stderr.write(str(ex))
    sys.exit(1)
`, sandboxId, filePath], {
            env: { ...process.env },
            timeout: 60000,
          });

          let errOut = "";

          // Collect base64 output in chunks; decode progressively to avoid full-buffer spike.
          // We wait for close to send headers so we can fall back to local on error.
          let b64Chunks: Buffer[] = [];
          py.stdout.on("data", (chunk: Buffer) => { b64Chunks.push(chunk); });
          py.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });

          py.on("close", (code: number | null) => {
            if (code === 0) {
              // Decode base64 in one pass (avoid allocating double buffers for small files;
              // for large files this is still memory-efficient: we only have base64 chunks
              // in memory momentarily while decoding then they are GC'd).
              const b64 = Buffer.concat(b64Chunks).toString("ascii");
              const rawBuf = Buffer.from(b64, "base64");
              res.setHeader("Content-Type", mimeType);
              res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
              res.setHeader("Content-Length", rawBuf.length);
              res.setHeader("Cache-Control", "no-cache");
              res.end(rawBuf);
              resolve(true);
            } else {
              console.warn(`[FileDownload] E2B proxy Python exited ${code}: ${errOut.trim()}`);
              resolve(false);
            }
          });

          py.on("error", (err: Error) => { reject(err); });
        });

        if (streamed) return;
        // E2B proxy failed — do not fall back to local disk
        if (!res.headersSent) {
          return res.status(502).json({ error: "Failed to retrieve file from E2B sandbox. Please try again." });
        }
        return;
      } catch (e2bErr: any) {
        console.warn(`[FileDownload] E2B proxy failed: ${e2bErr.message}`);
        if (!res.headersSent) {
          return res.status(502).json({ error: "E2B sandbox error: " + e2bErr.message });
        }
        return;
      }
    }

    // No sandbox available — cannot serve file without E2B
    return res.status(503).json({
      error: "File download requires an active E2B sandbox. E2B_API_KEY is not set or no active sandbox.",
    });
  });

  // ─── /api/sandbox/download — manus.im parity endpoint ───────────────────
  // Same implementation as /api/files/download but also accepts `filename` param
  // (in addition to `name`) for full contract compatibility.
  // Supports one-time token auth (token= query param) in addition to Bearer auth.
  app.get("/api/sandbox/download", (req: any, res: any) => {
    // Normalize `filename` → `name` so the /api/files/download handler accepts it
    if (req.query.filename && !req.query.name) {
      req.query.name = req.query.filename;
    }
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    // Use 307 (Temporary Redirect) to preserve query params (including token)
    res.redirect(307, `/api/files/download?${qs}`);
  });

  // ─── File Upload endpoint ────────────────────────────────────────────────────
  // Uses memory storage — buffers pushed directly to E2B sandbox (no local disk write)
  app.post("/api/upload", requireAuth, (req: any, res: any, next: any) => {
    upload.array("files", 10)(req, res, async (multerErr: any) => {
      if (multerErr) {
        const msg = multerErr.code === "LIMIT_FILE_SIZE"
          ? "File terlalu besar (max 50MB)"
          : multerErr.message || "Upload gagal";
        return res.status(400).json({ error: msg });
      }
      try {
        const files = (req.files as any[]) || [];
        if (files.length === 0) {
          return res.status(400).json({ error: "Tidak ada file yang diunggah" });
        }

        const sandboxId = getActiveE2BSandboxId();
        const e2bKey = process.env.E2B_API_KEY || "";

        if (!sandboxId || !e2bKey) {
          return res.status(503).json({
            error: "File upload requires an active E2B sandbox. No sandbox is currently connected.",
          });
        }

        const result = await Promise.all(files.map(async (f: any) => {
          const fileName = f.originalname;
          const mime = f.mimetype || "application/octet-stream";
          const size = f.size;
          const buffer: Buffer = f.buffer;
          const isImage = mime.startsWith("image/");
          const isText = mime.startsWith("text/") || /\.(txt|md|py|js|ts|json|csv|xml|html|css|sh|yaml|yml|toml|ini|log)$/i.test(fileName);

          let preview: string | null = null;
          if (isText && size < 500 * 1024) {
            try { preview = buffer.toString("utf-8"); } catch {}
          }

          // Push buffer directly to E2B sandbox
          let sandboxPath = `/home/user/upload/${fileName}`;
          let downloadUrl = "";

          try {
            const pushResult = await new Promise<{ ok: boolean; path: string }>((resolve) => {
              const py = spawn("python3", ["-c", `
import sys, base64, os
e2b_key = os.environ.get("E2B_API_KEY", "")
sandbox_id = sys.argv[1]
dest_path = sys.argv[2]
try:
    from e2b_desktop import Sandbox
    sb = Sandbox.connect(sandbox_id, api_key=e2b_key)
    data = sys.stdin.buffer.read()
    parent = os.path.dirname(dest_path)
    if parent:
        sb.commands.run(f"mkdir -p {parent}", timeout=10)
    sb.files.write(dest_path, data)
    print("ok:" + dest_path)
except Exception as ex:
    sys.stderr.write(str(ex))
    sys.exit(1)
`, sandboxId, sandboxPath], { env: { ...process.env }, timeout: 30000 });
              let out = "";
              let errOut = "";
              py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
              py.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
              py.stdin.write(buffer);
              py.stdin.end();
              py.on("close", (code: number | null) => {
                if (code === 0 && out.startsWith("ok:")) {
                  resolve({ ok: true, path: out.slice(3).trim() });
                } else {
                  console.warn(`[Upload] E2B push failed for ${fileName}: ${errOut.trim()}`);
                  resolve({ ok: false, path: sandboxPath });
                }
              });
              py.on("error", () => resolve({ ok: false, path: sandboxPath }));
            });

            if (pushResult.ok) {
              sandboxPath = pushResult.path;
              downloadUrl = `/api/files/download?sandbox_id=${encodeURIComponent(sandboxId)}&path=${encodeURIComponent(sandboxPath)}&name=${encodeURIComponent(fileName)}`;
            } else {
              throw new Error(`E2B push failed for ${fileName}`);
            }
          } catch (e2bErr: any) {
            console.warn(`[Upload] E2B push exception for ${fileName}:`, e2bErr.message);
            throw e2bErr;
          }

          return {
            filename: fileName,
            path: sandboxPath,
            mime,
            size,
            is_image: isImage,
            is_text: isText,
            preview,
            download_url: downloadUrl,
            sandbox_path: sandboxPath,
          };
        }));

        res.json({ files: result });
      } catch (err: any) {
        res.status(500).json({ error: "Upload gagal: " + err.message });
      }
    });
  });

  // ─── Session-specific upload endpoint ────────────────────────────────────────
  // POST /api/sessions/:sessionId/upload
  // Same as /api/upload but associates the file with a session in MongoDB.
  app.post("/api/sessions/:sessionId/upload", requireAuth, (req: any, res: any, next: any) => {
    upload.array("files", 10)(req, res, async (multerErr: any) => {
      if (multerErr) {
        const msg = multerErr.code === "LIMIT_FILE_SIZE"
          ? "File terlalu besar (max 50MB)"
          : multerErr.message || "Upload gagal";
        return res.status(400).json({ error: msg });
      }
      const { sessionId } = req.params;
      const requestingUserId: string = req.user?.id || "";

      // ── Session ownership check (same pattern as GET /files) ──────────────
      const liveSession = activeAgentSessions.get(sessionId);
      if (liveSession) {
        const sessionOwner: string = (liveSession as any)._userId || "";
        if (!sessionOwner || requestingUserId !== sessionOwner) {
          return res.status(403).json({ error: "Access denied" });
        }
      } else {
        let ownerVerified = false;
        try {
          const sessionCol = await getCollection("agent_sessions");
          if (sessionCol) {
            const sessionDoc = await (sessionCol as any).findOne(
              { session_id: sessionId },
              { projection: { user_id: 1 } },
            );
            if (sessionDoc) {
              const owner: string = sessionDoc.user_id || "";
              if (!owner || requestingUserId !== owner) {
                return res.status(403).json({ error: "Access denied" });
              }
              ownerVerified = true;
            }
          }
        } catch (err: any) {
          console.warn("[SessionUpload] Ownership check failed:", err.message);
        }
        if (!ownerVerified) {
          return res.status(403).json({ error: "Access denied" });
        }
      }

      try {
        const files = (req.files as any[]) || [];
        if (files.length === 0) {
          return res.status(400).json({ error: "Tidak ada file yang diunggah" });
        }

        // Prefer session-bound sandbox (stored on live session) over the global singleton.
        // This prevents cross-session sandbox contamination when multiple users are active.
        const sessionBoundSandboxId: string = (liveSession as any)?._sandboxId || "";
        const sandboxId = sessionBoundSandboxId || getActiveE2BSandboxId();
        const e2bKey = process.env.E2B_API_KEY || "";

        if (!sandboxId || !e2bKey) {
          return res.status(503).json({
            error: "File upload requires an active E2B sandbox. No sandbox is currently connected.",
          });
        }

        const result = await Promise.all(files.map(async (f: any) => {
          const fileName = f.originalname;
          const mime = f.mimetype || "application/octet-stream";
          const size = f.size;
          const buffer: Buffer = f.buffer;
          const isImage = mime.startsWith("image/");
          const isText = mime.startsWith("text/") || /\.(txt|md|py|js|ts|json|csv|xml|html|css|sh|yaml|yml|toml|ini|log)$/i.test(fileName);

          let preview: string | null = null;
          if (isText && size < 500 * 1024) {
            try { preview = buffer.toString("utf-8"); } catch {}
          }

          let sandboxPath = `/home/user/sessions/${sessionId}/${fileName}`;
          let downloadUrl = "";

          try {
            const pushResult = await new Promise<{ ok: boolean; path: string }>((resolve) => {
              const py = spawn("python3", ["-c", `
import sys, os
e2b_key = os.environ.get("E2B_API_KEY", "")
sandbox_id = sys.argv[1]
dest_path = sys.argv[2]
try:
    from e2b_desktop import Sandbox
    sb = Sandbox.connect(sandbox_id, api_key=e2b_key)
    data = sys.stdin.buffer.read()
    parent = os.path.dirname(dest_path)
    if parent:
        sb.commands.run(f"mkdir -p {parent}", timeout=10)
    sb.files.write(dest_path, data)
    print("ok:" + dest_path)
except Exception as ex:
    sys.stderr.write(str(ex))
    sys.exit(1)
`, sandboxId, sandboxPath], { env: { ...process.env }, timeout: 30000 });
              let out = "";
              let errOut = "";
              py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
              py.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
              py.stdin.write(buffer);
              py.stdin.end();
              py.on("close", (code: number | null) => {
                if (code === 0 && out.startsWith("ok:")) {
                  resolve({ ok: true, path: out.slice(3).trim() });
                } else {
                  resolve({ ok: false, path: sandboxPath });
                }
              });
              py.on("error", () => resolve({ ok: false, path: sandboxPath }));
            });

            if (pushResult.ok) {
              sandboxPath = pushResult.path;
              downloadUrl = `/api/files/download?sandbox_id=${encodeURIComponent(sandboxId)}&path=${encodeURIComponent(sandboxPath)}&name=${encodeURIComponent(fileName)}`;
            } else {
              throw new Error(`E2B push failed for ${fileName}`);
            }
          } catch (e2bErr: any) {
            throw e2bErr;
          }

          // Store file bytes in MongoDB GridFS via stdin (safe for large files — no argv limit).
          // Args: session_id, filename, mime_type, user_id  |  stdin: raw file bytes
          let gridfsFileId: string | null = null;
          try {
            gridfsFileId = await new Promise<string | null>((resolve) => {
              const pyScript = `
import asyncio, json, sys
from server.agent.db.gridfs import upload_file
async def main():
    data = sys.stdin.buffer.read()
    fid = await upload_file(
        session_id=sys.argv[1],
        filename=sys.argv[2],
        data_bytes=data,
        mime_type=sys.argv[3],
        user_id=sys.argv[4],
    )
    print(json.dumps({"file_id": fid}))
asyncio.run(main())
`.trim();
              const pyProc = spawn("python3", ["-c", pyScript, sessionId, fileName, mime, requestingUserId], {
                env: { ...process.env },
                timeout: 60000,
              });
              let out = "";
              let errOut = "";
              pyProc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
              pyProc.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
              pyProc.stdin.write(buffer);
              pyProc.stdin.end();
              pyProc.on("close", (code: number | null) => {
                if (code === 0 && out.trim()) {
                  try {
                    const parsed = JSON.parse(out.trim());
                    resolve(parsed.file_id || null);
                  } catch {
                    resolve(null);
                  }
                } else {
                  console.warn("[SessionUpload] GridFS upload stderr:", errOut.trim() || out.trim());
                  resolve(null);
                }
              });
              pyProc.on("error", () => resolve(null));
            });
          } catch (gfsErr: any) {
            console.warn("[SessionUpload] GridFS spawn error:", gfsErr.message);
          }

          // GridFS persistence is mandatory — hard-fail if GridFS is unavailable.
          if (!gridfsFileId) {
            throw new Error(
              `GridFS storage unavailable for file '${fileName}'. ` +
              "MongoDB GridFS is required for file persistence (no fallback).",
            );
          }

          // GridFS succeeded — use its URL as the canonical download URL.
          downloadUrl = `/api/files/${gridfsFileId}`;

          // Record metadata in session_files collection with canonical schema.
          // (matches GET /api/sessions/:sessionId/files reader and GridFS list)
          try {
            const col = await getCollection("session_files");
            if (col) {
              await (col as any).insertOne({
                session_id: sessionId,
                name: fileName,
                path: sandboxPath,
                size,
                mime_type: mime,
                download_url: downloadUrl,
                gridfs_file_id: gridfsFileId,
                created_at: new Date(),
                user_id: requestingUserId,
              });
            }
          } catch (dbErr: any) {
            console.warn("[SessionUpload] Failed to record file in MongoDB:", dbErr.message);
          }

          return {
            name: fileName,
            path: sandboxPath,
            mime_type: mime,
            size,
            is_image: isImage,
            is_text: isText,
            preview,
            download_url: downloadUrl,
            gridfs_file_id: gridfsFileId,
            session_id: sessionId,
          };
        }));

        res.json({ files: result, session_id: sessionId });
      } catch (err: any) {
        res.status(500).json({ error: "Upload gagal: " + err.message });
      }
    });
  });

  // ─── File list endpoint (files in E2B sandbox output directory) ─────────────
  app.get("/api/files/list", async (_req: any, res: any) => {
    const sandboxId = getActiveE2BSandboxId();
    const e2bKey = process.env.E2B_API_KEY || "";

    if (!sandboxId || !e2bKey) {
      return res.json({ files: [] });
    }

    try {
      const listResult = await new Promise<string>((resolve) => {
        const py = spawn("python3", ["-c", `
import sys, json, os
e2b_key = os.environ.get("E2B_API_KEY", "")
sandbox_id = sys.argv[1]
try:
    from e2b_desktop import Sandbox
    sb = Sandbox.connect(sandbox_id, api_key=e2b_key)
    r = sb.commands.run("find /home/user/output -maxdepth 2 -type f 2>/dev/null | head -50", timeout=10)
    files = [l.strip() for l in (r.stdout or "").split("\\n") if l.strip()]
    print(json.dumps(files))
except Exception as ex:
    print(json.dumps([]))
`, sandboxId], { env: { ...process.env }, timeout: 20000 });
        let out = "";
        py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        py.on("close", () => resolve(out.trim()));
        py.on("error", () => resolve("[]"));
      });

      const filePaths: string[] = JSON.parse(listResult || "[]");
      const files = filePaths.map((fp: string) => ({
        name: path.basename(fp),
        path: fp,
        download_url: `/api/files/download?sandbox_id=${encodeURIComponent(sandboxId)}&path=${encodeURIComponent(fp)}&name=${encodeURIComponent(path.basename(fp))}`,
      }));
      res.json({ files });
    } catch {
      res.json({ files: [] });
    }
  });

  // ─── GridFS file download by file_id ─────────────────────────────────────
  // Registered AFTER /api/files/download and /api/files/list so that those
  // specific paths are matched first, not captured by :fileId.
  // GET /api/files/:fileId → stream file bytes from MongoDB GridFS
  app.get("/api/files/:fileId", requireAuth, async (req: any, res: any) => {
    const { fileId } = req.params;
    const requestingUserId: string = req.user?.id || "";
    try {
      const result = await new Promise<{
        ok: boolean;
        data?: Buffer;
        mime?: string;
        filename?: string;
        owner_user_id?: string;
        error?: string;
      }>((resolve) => {
        const py = spawn("python3", ["-c", `
import sys, json, asyncio, os
file_id = sys.argv[1]
async def main():
    try:
        from server.agent.db.gridfs import download_file, get_file_metadata
        meta = await get_file_metadata(file_id)
        if meta is None:
            print(json.dumps({"ok": False, "error": "not_found"}))
            return
        data = await download_file(file_id)
        import base64
        print(json.dumps({
            "ok": True,
            "data": base64.b64encode(data).decode(),
            "mime": meta.mime_type,
            "filename": meta.filename,
            "owner_user_id": getattr(meta, "user_id", None),
        }))
    except FileNotFoundError:
        print(json.dumps({"ok": False, "error": "not_found"}))
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}))
asyncio.run(main())
`, fileId], {
          env: { ...process.env },
          cwd: process.cwd(),
          timeout: 30000,
        });
        let out = "";
        let errOut = "";
        py.stdout.on("data", (d: Buffer) => { out += d.toString(); });
        py.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
        py.on("close", (_code: number | null) => {
          try {
            const parsed = JSON.parse(out.trim());
            if (parsed.ok && parsed.data) {
              const buf = Buffer.from(parsed.data, "base64");
              resolve({ ok: true, data: buf, mime: parsed.mime, filename: parsed.filename, owner_user_id: parsed.owner_user_id });
            } else {
              resolve({ ok: false, error: parsed.error || "unknown error" });
            }
          } catch {
            resolve({ ok: false, error: errOut.trim() || "Failed to parse GridFS response" });
          }
        });
        py.on("error", (err: Error) => resolve({ ok: false, error: err.message }));
      });

      if (!result.ok || !result.data) {
        if (result.error === "not_found") {
          return res.status(404).json({ error: "File not found" });
        }
        return res.status(502).json({ error: result.error || "Failed to retrieve file from GridFS" });
      }

      // Enforce ownership: owner must match the requesting user.
      // Files without owner metadata (legacy or direct-uploaded) are also denied
      // unless the requesting user is verified by the session store.
      if (!result.owner_user_id) {
        // No owner metadata — deny to prevent enumeration of unattributed files
        return res.status(403).json({ error: "File owner could not be verified" });
      }
      if (requestingUserId !== result.owner_user_id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const mime = result.mime || "application/octet-stream";
      const filename = result.filename || fileId;
      res.setHeader("Content-Type", mime);
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", result.data.length);
      res.setHeader("Cache-Control", "no-cache");
      res.end(result.data);
    } catch (err: any) {
      console.warn("[GridFS] File download error:", err.message);
      res.status(500).json({ error: "Internal error while retrieving file" });
    }
  });

  // ─── E2B Desktop VNC viewer page ────────────────────────────────────────────
  app.get("/vnc-view", (_req: any, res: any) => {
    const html = path.join(__dirname, "templates", "e2b-vnc-view.html");
    if (fs.existsSync(html)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(html);
    } else {
      res.status(404).send("e2b-vnc-view.html not found");
    }
  });

  // ─── Tools health check endpoint ─────────────────────────────────────────
  app.get("/api/health/tools", async (_req: any, res: any) => {
    const e2bOn = isE2BEnabled();
    const cerebrasConfigured = !!getCerebrasConfig().apiKey;
    const timestamp = new Date().toISOString();

    // Fast lightweight Python probe: only checks imports + search — NO sandbox creation.
    // Sandbox active status is determined from the Node.js-managed E2B desktop sessions.
    let pythonProbe: Record<string, any> = {};
    try {
      const probe = await new Promise<string>((resolve) => {
        const py = spawn("python3", ["-c", `
import json, sys, os
results = {}
try:
    from server.agent.tools import ShellTool, FileTool, BrowserTool, SearchTool, MessageTool, idle, TodoTool, TaskTool, IdleTool
    results['imports'] = 'ok'
except Exception as e:
    results['imports'] = str(e)
try:
    import requests
    results['requests'] = 'ok'
except ImportError:
    results['requests'] = 'missing'
try:
    from server.agent.tools.search import web_search as _ws
    results['search'] = 'ok'
except Exception as e:
    results['search'] = str(e)
e2b_key = os.environ.get("E2B_API_KEY", "")
results['e2b_key_set'] = bool(e2b_key)
try:
    from server.agent.tools.e2b_sandbox import _sandbox, WORKSPACE_DIR
    results['e2b_module'] = 'ok'
    results['sandbox_active'] = _sandbox is not None
except Exception as e:
    results['e2b_module'] = str(e)
    results['sandbox_active'] = False
print(json.dumps(results))
`], { env: { ...process.env }, timeout: 15000 });
        let out = "";
        py.stdout.on("data", (d: any) => { out += d.toString(); });
        py.on("close", () => resolve(out.trim()));
        setTimeout(() => { try { py.kill(); } catch {} resolve("{}"); }, 12000);
      });
      pythonProbe = JSON.parse(probe || "{}");
    } catch (err: any) {
      pythonProbe = { error: String(err) };
    }

    const importsOk = pythonProbe.imports === "ok";
    const searchOk = pythonProbe.search === "ok";

    // Determine sandbox active state from Node.js E2B desktop session manager
    let sandboxActive = false;
    let sandboxId: string | null = null;
    try {
      sandboxId = getActiveE2BSandboxId();
      sandboxActive = !!sandboxId;
    } catch {}

    // If a sandbox is active, run lightweight E2E probes against the EXISTING sandbox
    // (no sandbox creation — connects via DZECK_E2B_SANDBOX_ID env var).
    let e2eProbe: Record<string, any> = {};
    if (sandboxActive && sandboxId && e2bOn && importsOk) {
      try {
        const e2eResult = await new Promise<string>((resolve) => {
          const e2ePy = spawn("python3", ["-c", `
import json, os
results = {}
sid = os.environ.get("DZECK_E2B_SANDBOX_ID", "")
if not sid:
    results['error'] = 'no_sandbox_id'
    print(json.dumps(results))
    raise SystemExit(0)
try:
    from server.agent.tools.e2b_sandbox import _connect_existing_sandbox, WORKSPACE_DIR
    sb = _connect_existing_sandbox(sid)
    if sb is None:
        results['sandbox'] = 'connect_failed'
        print(json.dumps(results))
        raise SystemExit(0)
    results['sandbox'] = 'connected'
    # E2E shell
    try:
        r = sb.commands.run("echo dzeck_health_ok", timeout=8)
        results['shell_e2e'] = 'ok' if 'dzeck_health_ok' in (r.stdout or '') else 'fail'
    except Exception as e:
        results['shell_e2e'] = str(e)[:80]
    # E2E file
    try:
        tp = WORKSPACE_DIR + '/.dzeck_health_test'
        sb.files.write(tp, 'health_check')
        rb = sb.files.read(tp)
        results['file_e2e'] = 'ok' if rb and 'health_check' in rb else 'fail'
        try: sb.commands.run(f"rm -f {tp}", timeout=5)
        except: pass
    except Exception as e:
        results['file_e2e'] = str(e)[:80]
    # E2E browser/display
    try:
        dr = sb.commands.run(
            "DISPLAY=:0 xdpyinfo 2>/dev/null | head -1 && echo display_ok || echo no_display; "
            "pgrep -x -E 'chrome|chromium' 2>/dev/null && echo browser_running || echo browser_not_running",
            timeout=8
        )
        out = dr.stdout or ''
        results['browser_e2e'] = 'display_ok' if 'display_ok' in out else 'no_display'
        results['browser_running'] = 'browser_running' in out
    except Exception as e:
        results['browser_e2e'] = str(e)[:80]
        results['browser_running'] = False
except Exception as e:
    results['error'] = str(e)[:100]
print(json.dumps(results))
`], { env: { ...process.env, DZECK_E2B_SANDBOX_ID: sandboxId }, timeout: 30000 });
          let out = "";
          e2ePy.stdout.on("data", (d: any) => { out += d.toString(); });
          e2ePy.on("close", () => resolve(out.trim()));
          setTimeout(() => { try { e2ePy.kill(); } catch {} resolve("{}"); }, 25000);
        });
        e2eProbe = JSON.parse(e2eResult || "{}");
      } catch {}
    }

    const shellOk = e2eProbe.shell_e2e === "ok";
    const fileOk = e2eProbe.file_e2e === "ok";
    const browserDisplayOk = e2eProbe.browser_e2e === "display_ok";
    const browserRunning = !!e2eProbe.browser_running;
    const e2eRan = sandboxActive && e2eProbe.sandbox === "connected";

    const toolStatus = (available: boolean, e2eResult?: string) => {
      if (!available) return "unavailable";
      if (e2eResult === "ok") return "active";
      if (e2eResult === "fail") return "error";
      if (sandboxActive) return "active";  // sandbox is live but no e2e ran (still accurate)
      return "ready";
    };

    console.log(`[Health] E2B sandbox: ${sandboxActive ? "✓ active" : "○ idle"} | imports: ${importsOk ? "✓" : "✗"} | search: ${searchOk ? "✓" : "✗"} | cerebras: ${cerebrasConfigured ? "✓" : "✗"}${e2eRan ? ` | shell: ${e2eProbe.shell_e2e} | file: ${e2eProbe.file_e2e} | browser: ${e2eProbe.browser_e2e}` : ""}`);

    res.json({
      status: "ok",
      timestamp,
      tools: {
        shell: {
          status: toolStatus(e2bOn && importsOk, e2eRan ? (shellOk ? "ok" : "fail") : undefined),
          requires: "E2B_API_KEY",
          available: e2bOn && importsOk,
          sandbox_active: sandboxActive,
          e2e_ok: e2eRan ? shellOk : null,
        },
        file: {
          status: toolStatus(e2bOn && importsOk, e2eRan ? (fileOk ? "ok" : "fail") : undefined),
          requires: "E2B_API_KEY",
          available: e2bOn && importsOk,
          e2e_ok: e2eRan ? fileOk : null,
        },
        browser: {
          status: e2bOn && importsOk ? (sandboxActive ? (e2eRan && !browserDisplayOk ? "error" : "active") : "ready") : "unavailable",
          requires: "E2B_API_KEY",
          available: e2bOn && importsOk,
          display_ok: e2eRan ? browserDisplayOk : null,
          browser_running: e2eRan ? browserRunning : null,
          e2e_result: e2eProbe.browser_e2e || (sandboxActive ? "not_checked" : "no_sandbox"),
        },
        search: { status: searchOk ? "ready" : "degraded", requires: "none", available: searchOk },
        message: { status: importsOk ? "ready" : "degraded", requires: "none", available: importsOk },
        todo: { status: importsOk ? "ready" : "degraded", requires: "none", available: importsOk },
        task: { status: importsOk ? "ready" : "degraded", requires: "none", available: importsOk },
        idle: { status: importsOk ? "ready" : "degraded", requires: "none", available: importsOk },
        mcp: { status: "ready", requires: "none", available: true },
      },
      e2b_enabled: e2bOn,
      cerebras_configured: cerebrasConfigured,
      python_probe: pythonProbe,
      e2e_probe: e2eProbe,
      sandbox_id: sandboxId,
      all_tools_ready: e2bOn && cerebrasConfigured && importsOk && (!e2eRan || (shellOk && fileOk)),
      e2e_verified: e2eRan && shellOk && fileOk,
    });
  });

  // ─── Global health check endpoint ─────────────────────────────────────────
  // GET /api/health — verifies MongoDB, Redis, and E2B connectivity.
  // If a critical service is not available, returns 503 with clear error message.
  app.get("/api/health", async (_req: any, res: any) => {
    const timestamp = new Date().toISOString();
    const services: Record<string, { status: string; message: string }> = {};

    // Check MongoDB
    try {
      const db = await getMongoDb();
      if (db) {
        await db.command({ ping: 1 });
        services.mongodb = { status: "ok", message: "Connected" };
      } else {
        services.mongodb = { status: "unavailable", message: "MONGODB_URI not set or connection failed" };
      }
    } catch (err: any) {
      services.mongodb = { status: "error", message: err.message };
    }

    // Check Redis
    try {
      const rc = getRedisClient();
      if (rc) {
        await rc.ping();
        services.redis = { status: "ok", message: "Connected" };
      } else {
        services.redis = { status: "unavailable", message: "REDIS_HOST not set or connection failed" };
      }
    } catch (err: any) {
      services.redis = { status: "error", message: err.message };
    }

    // Check E2B
    services.e2b = {
      status: isE2BEnabled() ? "configured" : "unavailable",
      message: isE2BEnabled() ? "E2B_API_KEY set" : "E2B_API_KEY not set",
    };

    // Check Cerebras
    services.cerebras = {
      status: !!process.env.CEREBRAS_API_KEY ? "configured" : "unavailable",
      message: !!process.env.CEREBRAS_API_KEY ? "CEREBRAS_API_KEY set" : "CEREBRAS_API_KEY not set",
    };

    const mongoOk = services.mongodb.status === "ok";
    const redisOk = services.redis.status === "ok";
    const criticalOk = mongoOk && redisOk;
    const overallStatus = criticalOk ? "ok" : "degraded";
    const failingServices = [
      ...(!mongoOk ? ["MongoDB"] : []),
      ...(!redisOk ? ["Redis"] : []),
    ];

    res.status(criticalOk ? 200 : 503).json({
      status: overallStatus,
      timestamp,
      services,
      message: criticalOk
        ? "All critical services are healthy"
        : `Critical services unavailable: ${failingServices.join(", ")}`,
    });
  });

  // ─── E2B Sandbox health check endpoint ───────────────────────────────────
  app.get("/api/e2b/health", (_req: any, res: any) => {
    const e2bOn = isE2BEnabled();
    res.json({
      e2b_enabled: e2bOn,
      e2b_api_key_set: !!process.env.E2B_API_KEY,
      status: e2bOn ? "ready" : "disabled",
      timestamp: new Date().toISOString(),
      message: e2bOn
        ? "E2B cloud sandbox is configured and ready"
        : "E2B_API_KEY not set. Set it in environment variables to enable cloud sandbox.",
    });
  });

  // ─── VNC status endpoint (E2B-based) ──────────────────────────────────────
  app.get("/api/vnc/status", (_req: any, res: any) => {
    const e2bOn = isE2BEnabled();
    res.json({
      ready: e2bOn,
      mode: "e2b",
      e2b_enabled: e2bOn,
      message: e2bOn
        ? "VNC tersedia melalui E2B Desktop Sandbox"
        : "E2B_API_KEY belum diset",
    });
  });

  // ─── Shell view endpoint (live shell output from E2B sandbox) ─────────────
  app.get("/api/sandbox/shell/:sessionId", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    const shellId = req.query.shell_id as string;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    try {
      // Return shell output from agent session event queue
      const session = activeAgentSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      // Extract shell tool events from event queue
      const shellEvents = session.eventQueue
        .filter(line => line.startsWith("data: "))
        .map(line => {
          try { return JSON.parse(line.slice(6)); } catch { return null; }
        })
        .filter((evt: any) => evt && evt.type === "tool" && evt.tool_content?.type === "shell")
        .map((evt: any) => ({
          tool_call_id: evt.tool_call_id,
          function_name: evt.function_name,
          status: evt.status,
          command: evt.tool_content?.command || "",
          console: evt.tool_content?.console || "",
          return_code: evt.tool_content?.return_code,
          id: evt.tool_content?.id || "",
        }));

      const filtered = shellId
        ? shellEvents.filter((e: any) => e.id === shellId || e.tool_call_id === shellId)
        : shellEvents;

      res.json({ shells: filtered, total: shellEvents.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── File view endpoint (file content from E2B sandbox) ────────────────────
  app.get("/api/sandbox/file/:sessionId", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    const filePath = req.query.path as string;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    try {
      const session = activeAgentSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      // Extract file tool events from event queue
      const fileEvents = session.eventQueue
        .filter(line => line.startsWith("data: "))
        .map(line => {
          try { return JSON.parse(line.slice(6)); } catch { return null; }
        })
        .filter((evt: any) => evt && evt.type === "tool" && evt.tool_content?.type === "file")
        .map((evt: any) => ({
          tool_call_id: evt.tool_call_id,
          function_name: evt.function_name,
          status: evt.status,
          file: evt.tool_content?.file || evt.function_args?.file || "",
          content: evt.tool_content?.content || "",
          operation: evt.tool_content?.operation || "",
          language: evt.tool_content?.language || "",
        }));

      const filtered = filePath
        ? fileEvents.filter((e: any) => e.file === filePath || e.file?.endsWith(filePath))
        : fileEvents;

      res.json({ files: filtered, total: fileEvents.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── VNC URL endpoint (E2B desktop stream URL) ────────────────────────────
  app.get("/api/sandbox/vnc-url/:sessionId", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    try {
      const session = activeAgentSessions.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      // Extract the latest browser tool event to get VNC/screenshot info
      const browserEvents = session.eventQueue
        .filter(line => line.startsWith("data: "))
        .map(line => {
          try { return JSON.parse(line.slice(6)); } catch { return null; }
        })
        .filter((evt: any) => evt && evt.type === "tool" && evt.tool_content?.type === "browser");

      const latest = browserEvents[browserEvents.length - 1];
      const e2bOn = isE2BEnabled();

      res.json({
        vnc_available: e2bOn,
        session_id: sessionId,
        url: latest?.tool_content?.url || "",
        title: latest?.tool_content?.title || "",
        screenshot_b64: latest?.tool_content?.screenshot_b64 || "",
        vnc_viewer_url: e2bOn ? `/vnc-view?session=${sessionId}` : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Sandbox tools summary endpoint ────────────────────────────────────────
  app.get("/api/sandbox/tools/:sessionId", requireAuth, async (req: any, res: any) => {
    const { sessionId } = req.params;
    const session = activeAgentSessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    try {
      const allToolEvents = session.eventQueue
        .filter(line => line.startsWith("data: "))
        .map(line => {
          try { return JSON.parse(line.slice(6)); } catch { return null; }
        })
        .filter((evt: any) => evt && evt.type === "tool");

      const summary = {
        total: allToolEvents.length,
        by_type: {} as Record<string, number>,
        latest: allToolEvents.slice(-5).map((evt: any) => ({
          tool_call_id: evt.tool_call_id,
          function_name: evt.function_name,
          tool_name: evt.tool_name,
          status: evt.status,
          content_type: evt.tool_content?.type || "unknown",
        })),
      };

      for (const evt of allToolEvents) {
        const type = (evt as any).tool_content?.type || "unknown";
        summary.by_type[type] = (summary.by_type[type] || 0) + 1;
      }

      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const httpServer = createServer(app);

  if (isE2BEnabled()) {
    console.log("[E2B] Cloud sandbox mode enabled. Browser/shell tools run in isolated E2B environment.");
  } else {
    console.warn("[E2B] E2B_API_KEY not set. Python agent will check env dynamically at request time.");
  }

  return httpServer;
}
