/**
 * E2B Desktop Sandbox Session Manager
 *
 * Provides cloud-based visual browser automation using @e2b/desktop SDK.
 * Architecture:
 *   1. E2B API provisions a Firecracker microVM with pre-built desktop template
 *   2. Inside the VM: XFCE4 desktop + Xvfb + x11vnc + noVNC are pre-installed
 *   3. @e2b/desktop SDK handles VNC streaming, screenshots, mouse/keyboard
 *   4. Client connects via noVNC (HTML5 Canvas) over WSS
 *
 * Endpoints:
 *   POST   /api/e2b/sessions          - Create a new desktop sandbox session
 *   GET    /api/e2b/sessions           - List active sessions
 *   GET    /api/e2b/sessions/:id       - Get session info
 *   GET    /api/e2b/sessions/:id/health - Health check
 *   DELETE /api/e2b/sessions/:id       - Destroy session
 *   GET    /api/e2b/sessions/:id/screenshot - Capture screenshot (PNG)
 *   POST   /api/e2b/sessions/:id/execute   - Execute command in sandbox
 *   GET    /api/e2b/sessions/:id/vnc-url   - Get WebSocket VNC URL
 *   POST   /api/e2b/sessions/:id/click     - Click at coordinates
 *   POST   /api/e2b/sessions/:id/scroll    - Scroll up/down
 *   POST   /api/e2b/sessions/:id/type      - Type text
 *   POST   /api/e2b/sessions/:id/press     - Press key(s)
 *   POST   /api/e2b/sessions/:id/launch    - Launch application
 *   POST   /api/e2b/sessions/:id/move-mouse - Move mouse
 *   POST   /api/e2b/sessions/:id/drag      - Drag from/to
 *   GET    /api/e2b/sessions/:id/cursor    - Get cursor position
 *   GET    /api/e2b/sessions/:id/screen-size - Get screen size
 */

import * as http from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";
import { Sandbox } from "@e2b/desktop";

// \u2500\u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface E2BDesktopSession {
  id: string;
  sandboxId: string;
  status: "starting" | "running" | "stopping" | "stopped" | "error";
  createdAt: number;
  lastActivity: number;
  vncUrl: string | null;
  wsProxyUrl: string | null;
  streamUrl: string | null;
  resolution: { width: number; height: number };
  timeout: number;
  error?: string;
  _idleTimer: ReturnType<typeof setTimeout> | null;
  _wsClients: Set<WsWebSocket>;
  _sandbox: Sandbox | null;
}

interface CreateSessionOptions {
  resolution?: { width: number; height: number };
  timeout?: number;
  startUrl?: string;
}

// Session Store
const activeSessions = new Map<string, E2BDesktopSession>();

// Default config
const DEFAULT_RESOLUTION = { width: 1280, height: 720 };
const DEFAULT_TIMEOUT = 3600;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function getE2BApiKey(): string {
  return process.env.E2B_API_KEY || "";
}

// Keep references to @e2b/desktop Sandbox instances keyed by sandboxId
const sandboxInstances = new Map<string, Sandbox>();

/**
 * Create an E2B Desktop sandbox using @e2b/desktop SDK.
 * Uses the pre-built desktop template (Ubuntu 22.04 + XFCE4 + VNC).
 */
async function createDesktopSandbox(
  resolution: { width: number; height: number },
  timeoutSec: number,
  retries = 2,
): Promise<{ sandboxId: string; sandbox: Sandbox } | null> {
  const apiKey = getE2BApiKey();
  if (!apiKey) {
    console.error("[E2B-Desktop] E2B_API_KEY not set");
    return null;
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(
        `[E2B-Desktop] Creating desktop sandbox via @e2b/desktop SDK (attempt ${attempt + 1}/${retries + 1})...`,
      );

      const sandbox = await Sandbox.create({
        apiKey,
        resolution: [resolution.width, resolution.height],
        dpi: 96,
        timeoutMs: timeoutSec * 1000,
      });

      const sandboxId = sandbox.sandboxId;
      sandboxInstances.set(sandboxId, sandbox);
      console.log(`[E2B-Desktop] Desktop sandbox created: ${sandboxId}`);
      return { sandboxId, sandbox };
    } catch (err: any) {
      const isRetryable =
        err.message?.includes("rate limit") ||
        err.message?.includes("timed out") ||
        err.message?.includes("timeout") ||
        err.code === "ECONNRESET" ||
        err.code === "ETIMEDOUT";
      if (isRetryable && attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(
          `[E2B-Desktop] Create sandbox attempt ${attempt + 1} failed, retrying in ${delay}ms: ${err.message}`,
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error(
        `[E2B-Desktop] Create sandbox failed after ${attempt + 1} attempts: ${err.message}`,
      );
      return null;
    }
  }
  return null;
}

/**
 * Execute a command inside the E2B sandbox via the official SDK.
 */
async function execInSandbox(
  sandboxId: string,
  command: string,
  timeoutMs = 30000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const sandbox = sandboxInstances.get(sandboxId);
  if (!sandbox) {
    throw new Error(`No SDK sandbox instance for ${sandboxId}`);
  }

  try {
    const result = await sandbox.commands.run(command, { timeoutMs });
    return {
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode,
    };
  } catch (err: any) {
    if (err.stdout !== undefined || err.stderr !== undefined) {
      return {
        stdout: err.stdout || "",
        stderr: err.stderr || err.message || "",
        exitCode: err.exitCode ?? 1,
      };
    }
    throw err;
  }
}

/**
 * Kill (destroy) an E2B sandbox via the official SDK.
 */
async function killE2BSandbox(sandboxId: string): Promise<void> {
  const sandbox = sandboxInstances.get(sandboxId);
  if (sandbox) {
    try {
      try {
        await sandbox.stream.stop();
      } catch {
        // Stream may not be started
      }
      await sandbox.kill();
    } catch (err: any) {
      if (
        !err.message?.includes("not found") &&
        !err.message?.includes("404")
      ) {
        throw err;
      }
    } finally {
      sandboxInstances.delete(sandboxId);
    }
  }
}

/**
 * Start VNC streaming and launch browser in the desktop sandbox.
 * The @e2b/desktop template already has XFCE4, Xvfb, x11vnc, noVNC pre-installed.
 */
async function bootstrapDesktop(
  sandboxId: string,
  startUrl?: string,
): Promise<{ streamUrl: string; vncUrl: string }> {
  const sandbox = sandboxInstances.get(sandboxId);
  if (!sandbox) {
    throw new Error(`No sandbox instance for ${sandboxId}`);
  }

  console.log(`[E2B-Desktop] Starting VNC stream for sandbox ${sandboxId}...`);
  await sandbox.stream.start({ requireAuth: false });

  const streamUrl = sandbox.stream.getUrl({
    autoConnect: true,
    viewOnly: false,
    resize: "scale",
  });

  console.log(`[E2B-Desktop] VNC stream ready: ${streamUrl}`);

  // Wait for desktop environment to be fully ready before launching browser
  await sandbox.wait(2000);

  const url = startUrl || "https://www.google.com";
  console.log(`[E2B-Desktop] Launching browser with URL: ${url}...`);

  let browserLaunched = false;
  const browsers = ["google-chrome", "chromium", "chromium-browser"];
  for (const browser of browsers) {
    try {
      await sandbox.launch(browser, url);
      console.log(`[E2B-Desktop] Browser launched successfully: ${browser}`);
      browserLaunched = true;
      break;
    } catch (err: any) {
      console.warn(
        `[E2B-Desktop] Failed to launch ${browser}: ${err.message}`,
      );
    }
  }

  if (!browserLaunched) {
    try {
      await sandbox.open(url);
      console.log(`[E2B-Desktop] URL opened via sandbox.open()`);
      browserLaunched = true;
    } catch (err: any) {
      console.warn(`[E2B-Desktop] sandbox.open() also failed: ${err.message}`);
    }
  }

  if (!browserLaunched) {
    console.error(
      `[E2B-Desktop] All browser launch methods failed for sandbox ${sandboxId}`,
    );
  }

  // Wait for browser to fully load
  await sandbox.wait(3000);

  return { streamUrl, vncUrl: streamUrl };
}

// Session Lifecycle

function touchSession(session: E2BDesktopSession) {
  session.lastActivity = Date.now();

  if (session._idleTimer) {
    clearTimeout(session._idleTimer);
    session._idleTimer = null;
  }

  session._idleTimer = setTimeout(() => {
    if (Date.now() - session.lastActivity >= IDLE_TIMEOUT_MS - 1000) {
      console.log(
        `[E2B-Desktop] Session ${session.id} idle timeout - auto-destroying`,
      );
      destroySession(session.id).catch(() => {});
    }
  }, IDLE_TIMEOUT_MS);
}

async function destroySession(sessionId: string): Promise<boolean> {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  session.status = "stopping";

  for (const client of session._wsClients) {
    try {
      client.close();
    } catch {}
  }
  session._wsClients.clear();

  if (session._idleTimer) {
    clearTimeout(session._idleTimer);
    session._idleTimer = null;
  }

  try {
    await killE2BSandbox(session.sandboxId);
    console.log(`[E2B-Desktop] Sandbox ${session.sandboxId} destroyed`);
  } catch (err: any) {
    console.error(
      `[E2B-Desktop] Failed to kill sandbox ${session.sandboxId}:`,
      err.message,
    );
  }

  session.status = "stopped";
  activeSessions.delete(sessionId);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions.entries()) {
    const age = (now - session.createdAt) / 1000;
    if (age > session.timeout) {
      console.log(
        `[E2B-Desktop] Session ${id} exceeded max timeout (${session.timeout}s) - destroying`,
      );
      destroySession(id).catch(() => {});
    }
  }
}, 5 * 60 * 1000);

// ─── Exported helpers for routes.ts ──────────────────────────────────────────

/**
 * Get the sandbox ID of the most recently active running E2B session.
 * Used by /api/agent to pass the existing sandbox to the Python agent
 * so it operates in the SAME sandbox the user is watching via VNC.
 */
export function getActiveE2BSandboxId(): string | null {
  let latest: E2BDesktopSession | null = null;
  for (const session of activeSessions.values()) {
    if (session.status === "running" && session.sandboxId) {
      if (!latest || session.lastActivity > latest.lastActivity) {
        latest = session;
      }
    }
  }
  return latest ? latest.sandboxId : null;
}

/**
 * Create a new E2B Desktop sandbox and register it as an active session.
 * Returns the session_id and sandbox_id so the frontend can connect to VNC,
 * and the Python agent can receive the sandbox_id via DZECK_E2B_SANDBOX_ID.
 */
export async function createAndRegisterE2BSandbox(startUrl?: string): Promise<{
  sessionId: string;
  sandboxId: string;
  streamUrl: string | null;
} | null> {
  const result = await createDesktopSandbox(DEFAULT_RESOLUTION, DEFAULT_TIMEOUT);
  if (!result) return null;

  const sessionId = randomUUID().slice(0, 12);
  const session: E2BDesktopSession = {
    id: sessionId,
    sandboxId: result.sandboxId,
    status: "starting",
    createdAt: Date.now(),
    lastActivity: Date.now(),
    vncUrl: null,
    wsProxyUrl: null,
    streamUrl: null,
    resolution: DEFAULT_RESOLUTION,
    timeout: DEFAULT_TIMEOUT,
    _idleTimer: null,
    _wsClients: new Set(),
    _sandbox: result.sandbox,
  };
  activeSessions.set(sessionId, session);

  try {
    const { streamUrl, vncUrl } = await bootstrapDesktop(result.sandboxId, startUrl || "https://www.google.com");
    session.streamUrl = streamUrl;
    session.vncUrl = vncUrl;
    session.wsProxyUrl = streamUrl;
    session.status = "running";
    touchSession(session);
    console.log(`[E2B-Desktop] Auto-created session ${sessionId}, sandbox ${result.sandboxId}, stream: ${streamUrl}`);
    return { sessionId, sandboxId: result.sandboxId, streamUrl };
  } catch (err: any) {
    console.error(`[E2B-Desktop] Bootstrap failed for auto-created session ${sessionId}:`, err.message);
    session.status = "error";
    session.error = err.message;
    return { sessionId, sandboxId: result.sandboxId, streamUrl: null };
  }
}

/**
 * Directly register an external E2B sandbox (created by Python agent) as an active session.
 * This is called directly from routes.ts instead of making an HTTP self-request,
 * which avoids timing/failure issues with internal HTTP calls.
 * Returns the new session_id, or an existing session_id if this sandbox is already registered.
 */
export async function registerExternalE2BSandbox(
  sandboxId: string,
  vncUrl: string,
): Promise<{ sessionId: string; vncUrl: string }> {
  // Check if already registered for this sandbox
  for (const [id, existing] of activeSessions.entries()) {
    if (existing.sandboxId === sandboxId) {
      const effectiveUrl = existing.streamUrl || existing.vncUrl || vncUrl;
      console.log(`[E2B-Desktop] Sandbox ${sandboxId} already registered as session ${id}`);
      return { sessionId: id, vncUrl: effectiveUrl };
    }
  }

  const apiKey = getE2BApiKey();
  let connectedSandbox: Sandbox | null = null;
  let effectiveVncUrl = vncUrl || "";

  if (apiKey) {
    try {
      connectedSandbox = await Sandbox.connect(sandboxId, { apiKey });
      sandboxInstances.set(sandboxId, connectedSandbox);
      console.log(`[E2B-Desktop] SDK connected to agent sandbox ${sandboxId}`);
    } catch (connectErr: any) {
      console.warn(
        `[E2B-Desktop] Could not SDK-connect to sandbox ${sandboxId}: ${connectErr.message}. ` +
        `VNC display will work but interaction endpoints may not.`,
      );
    }
  }

  // Try to start/retrieve VNC stream if we have SDK access and no URL yet
  if (connectedSandbox && !effectiveVncUrl) {
    try {
      await connectedSandbox.stream.start({ requireAuth: false });
      effectiveVncUrl = connectedSandbox.stream.getUrl({
        autoConnect: true,
        viewOnly: false,
        resize: "scale",
      });
      console.log(`[E2B-Desktop] VNC stream started for agent sandbox: ${effectiveVncUrl}`);
    } catch (streamErr: any) {
      console.warn(`[E2B-Desktop] Could not start VNC stream: ${streamErr.message}`);
    }
  }

  const sessionId = randomUUID().slice(0, 12);
  const session: E2BDesktopSession = {
    id: sessionId,
    sandboxId,
    status: "running",
    createdAt: Date.now(),
    lastActivity: Date.now(),
    vncUrl: effectiveVncUrl || null,
    wsProxyUrl: effectiveVncUrl || null,
    streamUrl: effectiveVncUrl || null,
    resolution: DEFAULT_RESOLUTION,
    timeout: DEFAULT_TIMEOUT,
    _idleTimer: null,
    _wsClients: new Set(),
    _sandbox: connectedSandbox,
  };
  activeSessions.set(sessionId, session);
  touchSession(session);

  console.log(
    `[E2B-Desktop] Registered external sandbox ${sandboxId} as session ${sessionId} (sdk: ${!!connectedSandbox})`,
  );
  return { sessionId, vncUrl: effectiveVncUrl };
}

// Route Registration

export function registerE2BDesktopRoutes(app: any, httpServer: http.Server) {
  if (!getE2BApiKey()) {
    console.warn(
      "[E2B-Desktop] E2B_API_KEY not set - desktop sandbox routes disabled",
    );
    return;
  }

  console.log(
    "[E2B-Desktop] Registering E2B desktop sandbox routes (@e2b/desktop SDK)",
  );

  // Create Session
  app.post("/api/e2b/sessions", async (req: any, res: any) => {
    try {
      const { resolution, timeout, startUrl } =
        (req.body as CreateSessionOptions) || {};
      const sessionId = randomUUID().slice(0, 12);
      const effectiveRes = resolution || DEFAULT_RESOLUTION;
      const effectiveTimeout = Math.min(timeout || DEFAULT_TIMEOUT, 7200);

      if (
        effectiveRes.width < 640 ||
        effectiveRes.width > 3840 ||
        effectiveRes.height < 480 ||
        effectiveRes.height > 2160
      ) {
        return res.status(400).json({
          error: "Invalid resolution. Width: 640-3840, Height: 480-2160.",
        });
      }

      console.log(
        `[E2B-Desktop] Creating session ${sessionId} (${effectiveRes.width}x${effectiveRes.height}, timeout: ${effectiveTimeout}s)`,
      );

      const result = await createDesktopSandbox(effectiveRes, effectiveTimeout);
      if (!result) {
        return res.status(500).json({
          error: "Failed to create E2B desktop sandbox. Check E2B_API_KEY.",
        });
      }

      const session: E2BDesktopSession = {
        id: sessionId,
        sandboxId: result.sandboxId,
        status: "starting",
        createdAt: Date.now(),
        lastActivity: Date.now(),
        vncUrl: null,
        wsProxyUrl: null,
        streamUrl: null,
        resolution: effectiveRes,
        timeout: effectiveTimeout,
        _idleTimer: null,
        _wsClients: new Set(),
        _sandbox: result.sandbox,
      };
      activeSessions.set(sessionId, session);

      res.json({
        session_id: sessionId,
        sandbox_id: result.sandboxId,
        status: "starting",
        resolution: effectiveRes,
        timeout: effectiveTimeout,
        message:
          "Desktop sandbox is being provisioned. Poll /api/e2b/sessions/:id/health for readiness.",
      });

      // Bootstrap in background
      try {
        const { streamUrl, vncUrl } = await bootstrapDesktop(
          result.sandboxId,
          startUrl,
        );
        session.streamUrl = streamUrl;
        session.vncUrl = vncUrl;
        session.wsProxyUrl = streamUrl;
        session.status = "running";
        touchSession(session);
        console.log(
          `[E2B-Desktop] Session ${sessionId} ready. Stream URL: ${streamUrl}`,
        );
      } catch (err: any) {
        console.error(
          `[E2B-Desktop] Bootstrap failed for session ${sessionId}:`,
          err.message,
        );
        session.status = "error";
        session.error = err.message;
      }
    } catch (err: any) {
      console.error("[E2B-Desktop] Create session error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Get the most recent running session (used by VNC viewer to auto-connect
  // to the agent's sandbox instead of creating a new one)
  app.get("/api/e2b/sessions/active", (_req: any, res: any) => {
    let latest: E2BDesktopSession | null = null;
    for (const session of activeSessions.values()) {
      if (session.status === "running" && session.streamUrl) {
        if (!latest || session.lastActivity > latest.lastActivity) {
          latest = session;
        }
      }
    }
    if (!latest) {
      return res.json({ found: false });
    }
    res.json({
      found: true,
      session_id: latest.id,
      sandbox_id: latest.sandboxId,
      status: latest.status,
      vnc_url: latest.vncUrl,
      stream_url: latest.streamUrl,
      resolution: latest.resolution,
    });
  });

  // List Sessions
  app.get("/api/e2b/sessions", (_req: any, res: any) => {
    const sessions = Array.from(activeSessions.values()).map((s) => ({
      session_id: s.id,
      sandbox_id: s.sandboxId,
      status: s.status,
      resolution: s.resolution,
      created_at: s.createdAt,
      last_activity: s.lastActivity,
      vnc_url: s.vncUrl,
      ws_proxy_url: s.wsProxyUrl,
      stream_url: s.streamUrl,
      timeout: s.timeout,
      connected_clients: s._wsClients.size,
      error: s.error,
    }));
    res.json({ sessions, count: sessions.length });
  });

  // Get Session Info
  app.get("/api/e2b/sessions/:id", (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({
      session_id: session.id,
      sandbox_id: session.sandboxId,
      status: session.status,
      resolution: session.resolution,
      created_at: session.createdAt,
      last_activity: session.lastActivity,
      vnc_url: session.vncUrl,
      ws_proxy_url: session.wsProxyUrl,
      stream_url: session.streamUrl,
      timeout: session.timeout,
      connected_clients: session._wsClients.size,
      idle_ms: Date.now() - session.lastActivity,
      remaining_timeout_s: Math.max(
        0,
        session.timeout - (Date.now() - session.createdAt) / 1000,
      ),
      error: session.error,
    });
  });

  // Health Check
  app.get("/api/e2b/sessions/:id/health", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found", ready: false });
    }
    if (session.status === "error") {
      return res.json({
        ready: false,
        status: session.status,
        error: session.error,
      });
    }
    if (session.status !== "running") {
      return res.json({ ready: false, status: session.status });
    }
    try {
      const result = await execInSandbox(
        session.sandboxId,
        "echo healthy",
        5000,
      );
      const healthy = result.exitCode === 0;
      touchSession(session);
      res.json({
        ready: healthy,
        status: session.status,
        vnc_url: session.vncUrl,
        ws_proxy_url: session.wsProxyUrl,
        stream_url: session.streamUrl,
        resolution: session.resolution,
      });
    } catch {
      res.json({ ready: false, status: "unhealthy" });
    }
  });

  // Connect to an existing sandbox (created by Python agent)
  // This allows the frontend to connect to the SAME sandbox the agent is using
  // instead of creating a separate one — unifying VNC display with tool execution.
  // Uses Sandbox.connect() from @e2b/desktop SDK to get a TS SDK instance so that
  // click/scroll/type/screenshot endpoints work on the agent's sandbox.
  app.post("/api/e2b/sessions/connect", async (req: any, res: any) => {
    try {
      const { sandbox_id, vnc_url, resolution } = req.body || {};
      if (!sandbox_id) {
        return res.status(400).json({ error: "sandbox_id is required" });
      }

      // Check if we already have a session for this sandbox
      for (const [id, existing] of activeSessions.entries()) {
        if (existing.sandboxId === sandbox_id) {
          // If stream URL is missing, try to start it now
          if (!existing.streamUrl) {
            const sb = sandboxInstances.get(sandbox_id);
            if (sb) {
              try {
                await sb.stream.start({ requireAuth: false });
                const url = sb.stream.getUrl({
                  autoConnect: true,
                  viewOnly: false,
                  resize: "scale",
                });
                existing.streamUrl = url;
                existing.vncUrl = url;
                existing.wsProxyUrl = url;
                console.log(
                  `[E2B-Desktop] Late-started VNC stream for session ${id}: ${url}`,
                );
              } catch (e: any) {
                console.warn(
                  `[E2B-Desktop] Could not late-start VNC stream: ${e.message}`,
                );
              }
            }
          }
          return res.json({
            session_id: id,
            sandbox_id: existing.sandboxId,
            status: existing.status,
            vnc_url: existing.vncUrl || vnc_url,
            stream_url: existing.streamUrl || vnc_url,
            resolution: existing.resolution,
            sdk_connected: !!sandboxInstances.get(sandbox_id),
            message: "Already connected to this sandbox.",
          });
        }
      }

      // Connect to the existing sandbox via @e2b/desktop SDK so that
      // interaction endpoints (click, scroll, type, screenshot, etc.) work
      const apiKey = getE2BApiKey();
      let connectedSandbox: Sandbox | null = null;
      if (apiKey) {
        try {
          connectedSandbox = await Sandbox.connect(sandbox_id, { apiKey });
          sandboxInstances.set(sandbox_id, connectedSandbox);
          console.log(
            `[E2B-Desktop] SDK connected to agent sandbox ${sandbox_id} for interaction`,
          );
        } catch (connectErr: any) {
          console.warn(
            `[E2B-Desktop] Could not SDK-connect to sandbox ${sandbox_id}: ${connectErr.message}. ` +
            `VNC display will work but interaction endpoints may not.`,
          );
        }
      }

      // Start VNC stream if we have SDK access and no vnc_url was provided
      let effectiveVncUrl = vnc_url || null;
      if (connectedSandbox && !effectiveVncUrl) {
        try {
          await connectedSandbox.stream.start({ requireAuth: false });
          effectiveVncUrl = connectedSandbox.stream.getUrl({
            autoConnect: true,
            viewOnly: false,
            resize: "scale",
          });
          console.log(`[E2B-Desktop] VNC stream started for agent sandbox: ${effectiveVncUrl}`);
        } catch (streamErr: any) {
          console.warn(`[E2B-Desktop] Could not start VNC stream: ${streamErr.message}`);
        }
      }

      const sessionId = randomUUID().slice(0, 12);
      const effectiveRes = resolution || DEFAULT_RESOLUTION;

      const session: E2BDesktopSession = {
        id: sessionId,
        sandboxId: sandbox_id,
        status: "running",
        createdAt: Date.now(),
        lastActivity: Date.now(),
        vncUrl: effectiveVncUrl,
        wsProxyUrl: effectiveVncUrl,
        streamUrl: effectiveVncUrl,
        resolution: effectiveRes,
        timeout: DEFAULT_TIMEOUT,
        _idleTimer: null,
        _wsClients: new Set(),
        _sandbox: connectedSandbox,
      };
      activeSessions.set(sessionId, session);
      touchSession(session);

      console.log(
        `[E2B-Desktop] Connected to existing sandbox ${sandbox_id} as session ${sessionId}`,
      );

      res.json({
        session_id: sessionId,
        sandbox_id: sandbox_id,
        status: "running",
        vnc_url: effectiveVncUrl,
        stream_url: effectiveVncUrl,
        resolution: effectiveRes,
        sdk_connected: !!connectedSandbox,
        message: "Connected to existing sandbox created by the agent.",
      });
    } catch (err: any) {
      console.error("[E2B-Desktop] Connect session error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // Destroy Session
  app.delete("/api/e2b/sessions/:id", async (req: any, res: any) => {
    const destroyed = await destroySession(req.params.id);
    if (!destroyed) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({ destroyed: true, session_id: req.params.id });
  });

  // Screenshot
  app.get(
    "/api/e2b/sessions/:id/screenshot",
    async (req: any, res: any) => {
      const session = activeSessions.get(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.status !== "running") {
        return res.status(400).json({ error: "Session not running" });
      }
      try {
        touchSession(session);
        const sandbox = sandboxInstances.get(session.sandboxId);
        if (!sandbox) {
          return res
            .status(500)
            .json({ error: "Sandbox instance not found" });
        }
        const screenshotBytes = await sandbox.screenshot("bytes");
        const imgBuffer = Buffer.from(screenshotBytes);
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Content-Length", imgBuffer.length);
        res.setHeader("Cache-Control", "no-store");
        res.send(imgBuffer);
      } catch (err: any) {
        res.status(500).json({ error: `Screenshot failed: ${err.message}` });
      }
    },
  );

  // Execute Command
  app.post(
    "/api/e2b/sessions/:id/execute",
    async (req: any, res: any) => {
      const session = activeSessions.get(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.status !== "running") {
        return res.status(400).json({ error: "Session not running" });
      }
      const { command, timeout: cmdTimeout } = req.body || {};
      if (!command) {
        return res.status(400).json({ error: "command is required" });
      }
      try {
        touchSession(session);
        const effectiveTimeout = Math.min(cmdTimeout || 30, 120) * 1000;
        const result = await execInSandbox(
          session.sandboxId,
          command,
          effectiveTimeout,
        );
        res.json({
          success: result.exitCode === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          exit_code: result.exitCode,
        });
      } catch (err: any) {
        res
          .status(500)
          .json({ error: `Execution failed: ${err.message}` });
      }
    },
  );

  // Get VNC URL
  app.get("/api/e2b/sessions/:id/vnc-url", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    // If session exists but VNC stream isn't ready yet, try to start it
    if (session.status === "running" && !session.streamUrl) {
      const sb = sandboxInstances.get(session.sandboxId);
      if (sb) {
        try {
          await sb.stream.start({ requireAuth: false });
          const url = sb.stream.getUrl({
            autoConnect: true,
            viewOnly: false,
            resize: "scale",
          });
          session.streamUrl = url;
          session.vncUrl = url;
          session.wsProxyUrl = url;
          console.log(
            `[E2B-Desktop] On-demand VNC stream started for session ${session.id}: ${url}`,
          );
        } catch {
          // Stream not available yet — fall through to retry response
        }
      }
    }
    if (session.status !== "running" || !session.streamUrl) {
      return res
        .status(202)
        .json({
          error: "VNC not ready yet",
          status: session.status,
          retry_after_ms: 2000,
          message: "Session is starting. Poll this endpoint again in 2 seconds.",
        });
    }
    touchSession(session);
    res.json({
      vnc_ws_url: session.wsProxyUrl,
      vnc_http_url: session.vncUrl,
      stream_url: session.streamUrl,
      resolution: session.resolution,
      connection: {
        url: session.streamUrl,
        shared: true,
        autoConnect: true,
        viewOnly: false,
        resize: "scale",
      },
    });
  });

  // Click
  app.post("/api/e2b/sessions/:id/click", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== "running") {
      return res.status(400).json({ error: "Session not running" });
    }
    const { x, y, button = "left", double: isDouble } = req.body || {};
    if (typeof x !== "number" || typeof y !== "number") {
      return res
        .status(400)
        .json({ error: "x and y coordinates are required (numbers)" });
    }
    try {
      touchSession(session);
      const sandbox = sandboxInstances.get(session.sandboxId);
      if (!sandbox) {
        return res
          .status(500)
          .json({ error: "Sandbox instance not found" });
      }
      if (isDouble) {
        await sandbox.doubleClick(x, y);
      } else if (button === "right") {
        await sandbox.rightClick(x, y);
      } else if (button === "middle") {
        await sandbox.middleClick(x, y);
      } else {
        await sandbox.leftClick(x, y);
      }
      res.json({
        success: true,
        action: isDouble ? "double_click" : `${button}_click`,
        x,
        y,
      });
    } catch (err: any) {
      res.status(500).json({ error: `Click failed: ${err.message}` });
    }
  });

  // Scroll
  app.post("/api/e2b/sessions/:id/scroll", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== "running") {
      return res.status(400).json({ error: "Session not running" });
    }
    const { direction = "down", amount = 3 } = req.body || {};
    try {
      touchSession(session);
      const sandbox = sandboxInstances.get(session.sandboxId);
      if (!sandbox) {
        return res
          .status(500)
          .json({ error: "Sandbox instance not found" });
      }
      await sandbox.scroll(direction, amount);
      res.json({ success: true, action: "scroll", direction, amount });
    } catch (err: any) {
      res.status(500).json({ error: `Scroll failed: ${err.message}` });
    }
  });

  // Type Text
  app.post("/api/e2b/sessions/:id/type", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== "running") {
      return res.status(400).json({ error: "Session not running" });
    }
    const { text } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: "text is required" });
    }
    try {
      touchSession(session);
      const sandbox = sandboxInstances.get(session.sandboxId);
      if (!sandbox) {
        return res
          .status(500)
          .json({ error: "Sandbox instance not found" });
      }
      await sandbox.write(text);
      res.json({ success: true, action: "type", length: text.length });
    } catch (err: any) {
      res.status(500).json({ error: `Type failed: ${err.message}` });
    }
  });

  // Press Key
  app.post("/api/e2b/sessions/:id/press", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== "running") {
      return res.status(400).json({ error: "Session not running" });
    }
    const { key } = req.body || {};
    if (!key) {
      return res
        .status(400)
        .json({ error: "key is required (string or array of strings)" });
    }
    try {
      touchSession(session);
      const sandbox = sandboxInstances.get(session.sandboxId);
      if (!sandbox) {
        return res
          .status(500)
          .json({ error: "Sandbox instance not found" });
      }
      await sandbox.press(key);
      res.json({ success: true, action: "press", key });
    } catch (err: any) {
      res.status(500).json({ error: `Press key failed: ${err.message}` });
    }
  });

  // Launch Application
  app.post("/api/e2b/sessions/:id/launch", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== "running") {
      return res.status(400).json({ error: "Session not running" });
    }
    const { application, uri } = req.body || {};
    if (!application) {
      return res.status(400).json({ error: "application is required" });
    }
    try {
      touchSession(session);
      const sandbox = sandboxInstances.get(session.sandboxId);
      if (!sandbox) {
        return res
          .status(500)
          .json({ error: "Sandbox instance not found" });
      }
      await sandbox.launch(application, uri);
      res.json({ success: true, action: "launch", application, uri });
    } catch (err: any) {
      res.status(500).json({ error: `Launch failed: ${err.message}` });
    }
  });

  // Mouse Move
  app.post(
    "/api/e2b/sessions/:id/move-mouse",
    async (req: any, res: any) => {
      const session = activeSessions.get(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.status !== "running") {
        return res.status(400).json({ error: "Session not running" });
      }
      const { x, y } = req.body || {};
      if (typeof x !== "number" || typeof y !== "number") {
        return res
          .status(400)
          .json({ error: "x and y coordinates are required (numbers)" });
      }
      try {
        touchSession(session);
        const sandbox = sandboxInstances.get(session.sandboxId);
        if (!sandbox) {
          return res
            .status(500)
            .json({ error: "Sandbox instance not found" });
        }
        await sandbox.moveMouse(x, y);
        res.json({ success: true, action: "move_mouse", x, y });
      } catch (err: any) {
        res
          .status(500)
          .json({ error: `Move mouse failed: ${err.message}` });
      }
    },
  );

  // Drag
  app.post("/api/e2b/sessions/:id/drag", async (req: any, res: any) => {
    const session = activeSessions.get(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    if (session.status !== "running") {
      return res.status(400).json({ error: "Session not running" });
    }
    const { fromX, fromY, toX, toY } = req.body || {};
    if (
      typeof fromX !== "number" ||
      typeof fromY !== "number" ||
      typeof toX !== "number" ||
      typeof toY !== "number"
    ) {
      return res.status(400).json({
        error: "fromX, fromY, toX, toY are all required (numbers)",
      });
    }
    try {
      touchSession(session);
      const sandbox = sandboxInstances.get(session.sandboxId);
      if (!sandbox) {
        return res
          .status(500)
          .json({ error: "Sandbox instance not found" });
      }
      await sandbox.drag([fromX, fromY], [toX, toY]);
      res.json({
        success: true,
        action: "drag",
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY },
      });
    } catch (err: any) {
      res.status(500).json({ error: `Drag failed: ${err.message}` });
    }
  });

  // Get Cursor Position
  app.get(
    "/api/e2b/sessions/:id/cursor",
    async (req: any, res: any) => {
      const session = activeSessions.get(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.status !== "running") {
        return res.status(400).json({ error: "Session not running" });
      }
      try {
        touchSession(session);
        const sandbox = sandboxInstances.get(session.sandboxId);
        if (!sandbox) {
          return res
            .status(500)
            .json({ error: "Sandbox instance not found" });
        }
        const pos = await sandbox.getCursorPosition();
        res.json({ success: true, x: pos.x, y: pos.y });
      } catch (err: any) {
        res
          .status(500)
          .json({ error: `Get cursor position failed: ${err.message}` });
      }
    },
  );

  // Get Screen Size
  app.get(
    "/api/e2b/sessions/:id/screen-size",
    async (req: any, res: any) => {
      const session = activeSessions.get(req.params.id);
      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }
      if (session.status !== "running") {
        return res.status(400).json({ error: "Session not running" });
      }
      try {
        touchSession(session);
        const sandbox = sandboxInstances.get(session.sandboxId);
        if (!sandbox) {
          return res
            .status(500)
            .json({ error: "Sandbox instance not found" });
        }
        const size = await sandbox.getScreenSize();
        res.json({ success: true, width: size.width, height: size.height });
      } catch (err: any) {
        res
          .status(500)
          .json({ error: `Get screen size failed: ${err.message}` });
      }
    },
  );

  // WebSocket VNC Proxy (local bridge)
  const vncWss = new WebSocketServer({ noServer: true });

  vncWss.on("connection", (clientWs: WsWebSocket, req: any) => {
    const url = req.url || "";
    const match = url.match(/\/api\/e2b\/sessions\/([^/]+)\/ws/);
    if (!match) {
      clientWs.close();
      return;
    }

    const sessionId = match[1];
    const session = activeSessions.get(sessionId);
    if (!session || session.status !== "running" || !session.wsProxyUrl) {
      clientWs.close(4404, "Session not found or not ready");
      return;
    }

    touchSession(session);
    session._wsClients.add(clientWs);
    console.log(
      `[E2B-Desktop] WS proxy client connected for session ${sessionId}`,
    );

    // E2B stream.getUrl() returns an HTTPS URL to a noVNC HTML page like:
    //   https://{sandbox-id}-stream.e2b.dev/vnc_lite.html?autoconnect=true&...
    // For the WS proxy, we need the actual WebSocket endpoint:
    //   wss://{sandbox-id}-stream.e2b.dev/websockify
    // Parse the URL and replace the path with /websockify for the raw VNC WebSocket
    let targetUrl: string;
    try {
      const parsed = new URL(session.wsProxyUrl!);
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      // If the URL points to an HTML page (noVNC viewer), redirect to websockify endpoint
      if (parsed.pathname.includes(".html") || parsed.pathname === "/") {
        parsed.pathname = "/websockify";
        parsed.search = ""; // Strip query params meant for the HTML viewer
      }
      targetUrl = parsed.toString();
    } catch {
      // Fallback: simple protocol swap
      targetUrl = session.wsProxyUrl!
        .replace("https://", "wss://")
        .replace("http://", "ws://");
    }
    console.log(`[E2B-Desktop] WS proxy connecting upstream to: ${targetUrl}`);
    const upstreamWs = new WsWebSocket(targetUrl, {
      headers: { Origin: "https://e2b.dev" },
    });

    upstreamWs.on("open", () => {
      console.log(
        `[E2B-Desktop] Upstream WS connected to E2B sandbox ${session.sandboxId}`,
      );
    });

    clientWs.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (upstreamWs.readyState === WsWebSocket.OPEN) {
        const buf = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
        upstreamWs.send(buf, { binary: true });
      }
    });

    upstreamWs.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (clientWs.readyState === WsWebSocket.OPEN) {
        const buf = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
        clientWs.send(buf, { binary: true });
      }
    });

    const cleanup = () => {
      session._wsClients.delete(clientWs);
      try {
        if (clientWs.readyState !== WsWebSocket.CLOSED) clientWs.close();
      } catch {}
      try {
        if (upstreamWs.readyState !== WsWebSocket.CLOSED) upstreamWs.close();
      } catch {}
    };

    upstreamWs.on("error", (err: Error) => {
      console.error(`[E2B-Desktop] Upstream WS error: ${err.message}`);
      cleanup();
    });
    upstreamWs.on("close", () => cleanup());
    clientWs.on("error", () => cleanup());
    clientWs.on("close", () => {
      console.log(
        `[E2B-Desktop] WS proxy client disconnected for session ${sessionId}`,
      );
      cleanup();
    });
  });

  httpServer.on("upgrade", (req: any, socket: any, head: any) => {
    const url = req.url || "";
    if (url.match(/\/api\/e2b\/sessions\/[^/]+\/ws/)) {
      vncWss.handleUpgrade(req, socket, head, (ws: WsWebSocket) => {
        vncWss.emit("connection", ws, req);
      });
    }
  });

  console.log(
    "[E2B-Desktop] Routes registered successfully (@e2b/desktop SDK)",
  );
}

// Cleanup on process exit
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.log(`[E2B-Desktop] Received ${sig}, cleaning up sessions...`);
    const cleanups = Array.from(activeSessions.keys()).map((id) =>
      destroySession(id).catch(() => {}),
    );
    Promise.allSettled(cleanups).finally(() => process.exit(0));
    const timer = setTimeout(() => process.exit(1), 5000);
    if (typeof timer === "object" && "unref" in timer) {
      (timer as NodeJS.Timeout).unref();
    }
  });
}

process.on("beforeExit", () => {
  for (const [id] of activeSessions) {
    destroySession(id).catch(() => {});
  }
});
