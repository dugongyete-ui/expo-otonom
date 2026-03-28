import { type Server, createServer } from "node:http";
import { spawn } from "node:child_process";
import * as https from "node:https";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import multer from "multer";
import { getActiveE2BSandboxId, createAndRegisterE2BSandbox, registerExternalE2BSandbox } from "./e2b-desktop";
import { requireAuth } from "./auth-routes";
import { getCollection } from "./db/mongo";

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
    session.eventQueue.push(line);
    for (const client of session.clients) {
      try {
        client.write(line);
        if (typeof client.flush === "function") client.flush();
      } catch {}
    }
    // Throttle sync to MongoDB: update every 10 events to avoid write storm
    if ((session as any)._mongoSyncing) return;
    const eventCount = session.eventQueue.length;
    const lastSyncedCount: number = (session as any)._lastSyncedEventCount ?? -1;
    if (eventCount - lastSyncedCount >= 10) {
      (session as any)._mongoSyncing = true;
      (session as any)._lastSyncedEventCount = eventCount;
      const sid: string = (session as any)._sessionId;
      if (sid) {
        getCollection("agent_sessions").then((col) => {
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
      const col = await getCollection("agent_sessions");
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

  app.get("/api/sessions/:sessionId/events", (req: any, res: any) => {
    const { sessionId } = req.params;
    const session = activeAgentSessions.get(sessionId);
    const isShared = sharedSessions.get(sessionId) || false;
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (!isShared) return res.status(403).json({ error: "Session is not shared" });
    res.json({ events: session.eventQueue, done: session.done });
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
          const newSession = await createAndRegisterE2BSandbox("https://www.google.com");
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

    const proc = spawn("python3", ["-u", "-m", "server.agent.agent_flow"], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: {
        ...process.env,
        CEREBRAS_API_KEY: apiKey,
        CEREBRAS_AGENT_MODEL: agentModel,
        PYTHONPATH: process.cwd(),
        PYTHONUNBUFFERED: "1",
        DZECK_SESSION_ID: sid,
        E2B_API_KEY: e2bKey,
        ...(dzeckSandboxId ? { DZECK_E2B_SANDBOX_ID: dzeckSandboxId } : {}),
      },
    });

    proc.stdin.write(JSON.stringify({
      message: message || "",
      messages: messages || [],
      model: agentModel,
      attachments: attachments || [],
      session_id: sid,
      resume_from_session: resume_from_session || null,
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
    activeAgentSessions.set(sid, session);

    // Sync new session to MongoDB for persistent history
    (async () => {
      try {
        const col = await getCollection("agent_sessions");
        if (col) {
          await (col as any).updateOne(
            { session_id: sid },
            {
              $set: {
                session_id: sid,
                done: false,
                startedAt: sessionStartedAt,
                eventCount: 0,
                is_running: true,
                user_message: message || (messages && messages.length > 0 ? messages[messages.length - 1]?.content : ""),
                created_at: new Date(),
                updated_at: new Date(),
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

    proc.stdout.on("data", (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "done") {
            session.done = true;
            _broadcastToSession(session, "data: [DONE]\n\n");
            for (const client of session.clients) { try { client.end(); } catch {} }
          } else {
            // When the Python agent emits a vnc_stream_url event, forward it AND
            // auto-connect to the sandbox so the frontend gets a unified session.
            // This bridges the Python agent's sandbox with the TS e2b-desktop session
            // system, enabling click/scroll/type interactions on the SAME sandbox.
            if (parsed.type === "vnc_stream_url" && parsed.vnc_url) {
              console.log(`[Agent] VNC stream URL received from Python sandbox: ${parsed.vnc_url}`);
              // Auto-register the agent's sandbox directly (no internal HTTP self-request)
              // This bridges the Python agent's sandbox with the TS e2b-desktop session
              // system, enabling click/scroll/type interactions on the SAME sandbox.
              if (parsed.sandbox_id) {
                registerExternalE2BSandbox(parsed.sandbox_id, parsed.vnc_url)
                  .then((result) => {
                    console.log(`[Agent] Auto-registered agent sandbox as e2b-desktop session: ${result.sessionId}`);
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
      /Sandbox health check/i, /sandbox creation failed/i];

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

      // Sync completed session to MongoDB
      (async () => {
        try {
          const col = await getCollection("agent_sessions");
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
      })();
    });

    res.on("close", () => { session.clients.delete(res); });
  });

  // ─── Reconnect to existing agent session ──────────────────────────────────
  app.get("/api/agent/stream/:sid", requireAuth, (req: any, res: any) => {
    const { sid } = req.params;
    const replay = req.query.replay === "true";
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }
    setupSSEHeaders(res);

    session.clients.add(res);
    if (replay) {
      for (const line of session.eventQueue) {
        try { res.write(line); } catch {}
      }
    }
    if (session.done) {
      try { res.write("data: [DONE]\n\n"); res.end(); } catch {}
    }
    res.on("close", () => { session.clients.delete(res); });
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

  app.get("/api/test", (_req: any, res: any) => {
    res.json({
      message: "API is working",
      timestamp: new Date().toISOString(),
      cerebrasConfigured: !!startupCfg.apiKey,
      e2bEnabled: isE2BEnabled(),
    });
  });

  // ─── File Download endpoint ─────────────────────────────────────────────────
  // Proxies file directly from E2B sandbox — no local disk copy.
  // Required: ?sandbox_id=xxx OR an active sandbox; ?path=/home/user/...&name=file.ext
  app.get("/api/files/download", requireAuth, async (req: any, res: any) => {
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

    // Run a Python probe that verifies tool imports AND performs E2E sandbox checks:
    // 1. Import verification (modules OK)
    // 2. E2B sandbox connect/create
    // 3. Shell: run echo command inside sandbox
    // 4. File: write then read back a test file inside sandbox
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

# E2B end-to-end verification
e2b_key = os.environ.get("E2B_API_KEY", "")
if e2b_key:
    try:
        from server.agent.tools.e2b_sandbox import get_sandbox, _detected_home, WORKSPACE_DIR
        results['e2b_module'] = 'ok'
        sb = get_sandbox()
        results['sandbox_active'] = sb is not None
        results['detected_home'] = _detected_home or ''
        if sb is not None:
            # E2E shell: run a simple echo command
            try:
                shell_r = sb.commands.run("echo dzeck_health_ok", timeout=10)
                results['shell_e2e'] = 'ok' if 'dzeck_health_ok' in (shell_r.stdout or '') else 'fail'
            except Exception as se:
                results['shell_e2e'] = str(se)[:100]
            # E2E file: write then read test file
            try:
                test_path = (_detected_home or WORKSPACE_DIR) + '/.dzeck_health_test'
                sb.files.write(test_path, 'health_check')
                read_back = sb.files.read(test_path)
                results['file_e2e'] = 'ok' if read_back and 'health_check' in read_back else 'fail'
                # Clean up
                try: sb.commands.run(f"rm -f {test_path}", timeout=5)
                except: pass
            except Exception as fe:
                results['file_e2e'] = str(fe)[:100]
            # E2E browser: check if display is available and browser is running/launchable
            try:
                display_r = sb.commands.run(
                    "which xdotool >/dev/null 2>&1 && echo xdotool_ok; "
                    "DISPLAY=:0 xdpyinfo 2>/dev/null | head -1 && echo display_ok; "
                    "pgrep -x -E 'chrome|chromium|chromium-browser|google-chrome' 2>/dev/null && echo browser_running || echo browser_not_running",
                    timeout=10
                )
                out = display_r.stdout or ''
                if 'display_ok' in out:
                    results['browser_e2e'] = 'display_ok'
                elif 'xdotool_ok' in out:
                    results['browser_e2e'] = 'xdotool_ok_no_display'
                else:
                    results['browser_e2e'] = 'no_display'
                results['browser_running'] = 'browser_running' in out
            except Exception as be:
                results['browser_e2e'] = str(be)[:100]
                results['browser_running'] = False
        else:
            results['shell_e2e'] = 'sandbox_unavailable'
            results['file_e2e'] = 'sandbox_unavailable'
            results['browser_e2e'] = 'sandbox_unavailable'
            results['browser_running'] = False
    except Exception as e:
        results['e2b_module'] = str(e)
        results['sandbox_active'] = False
        results['shell_e2e'] = 'module_error'
        results['file_e2e'] = 'module_error'
        results['browser_e2e'] = 'module_error'
else:
    results['e2b_module'] = 'no_api_key'
    results['sandbox_active'] = False
    results['shell_e2e'] = 'no_api_key'
    results['file_e2e'] = 'no_api_key'
    results['browser_e2e'] = 'no_api_key'
print(json.dumps(results))
`], { env: { ...process.env }, timeout: 45000 });
        let out = "";
        py.stdout.on("data", (d: any) => { out += d.toString(); });
        py.on("close", () => resolve(out.trim()));
        setTimeout(() => { try { py.kill(); } catch {} resolve("{}"); }, 40000);
      });
      pythonProbe = JSON.parse(probe || "{}");
    } catch (err: any) {
      pythonProbe = { error: String(err) };
    }

    const importsOk = pythonProbe.imports === "ok";
    const sandboxActive = !!pythonProbe.sandbox_active;
    const shellOk = pythonProbe.shell_e2e === "ok";
    const fileOk = pythonProbe.file_e2e === "ok";
    const searchOk = pythonProbe.search === "ok";
    const browserDisplayOk = pythonProbe.browser_e2e === "display_ok" || pythonProbe.browser_e2e === "xdotool_ok_no_display";
    const browserRunning = !!pythonProbe.browser_running;
    const e2eOk = e2bOn && sandboxActive && shellOk && fileOk;

    const toolStatus = (available: boolean, e2e?: boolean) => {
      if (!available) return "unavailable";
      if (e2e === true) return "active";
      if (e2e === false) return "error";
      return "ready";
    };

    console.log(`[Health] E2B sandbox: ${sandboxActive ? "✓ connected" : "✗ not connected"} | shell: ${pythonProbe.shell_e2e} | file: ${pythonProbe.file_e2e} | browser: ${pythonProbe.browser_e2e}`);

    res.json({
      status: "ok",
      timestamp,
      tools: {
        shell: {
          status: toolStatus(e2bOn && importsOk, sandboxActive ? shellOk : undefined),
          requires: "E2B_API_KEY",
          available: e2bOn && importsOk,
          sandbox_active: sandboxActive,
          e2e_ok: shellOk,
        },
        file: {
          status: toolStatus(e2bOn && importsOk, sandboxActive ? fileOk : undefined),
          requires: "E2B_API_KEY",
          available: e2bOn && importsOk,
          e2e_ok: fileOk,
        },
        browser: {
          status: e2bOn && importsOk ? (sandboxActive ? (browserDisplayOk ? "active" : "ready") : "ready") : "unavailable",
          requires: "E2B_API_KEY",
          available: e2bOn && importsOk,
          display_ok: browserDisplayOk,
          browser_running: browserRunning,
          e2e_result: pythonProbe.browser_e2e || "not_checked",
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
      detected_home: pythonProbe.detected_home || null,
      all_tools_ready: e2bOn && cerebrasConfigured && importsOk && e2eOk,
      e2e_verified: e2eOk,
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
