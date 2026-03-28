import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import * as https from "node:https";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import * as nodeHttp from "node:http";
import multer from "multer";
import { WebSocketServer, WebSocket as WsWebSocket } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _require = createRequire(import.meta.url);

// ─── File Download Store ─────────────────────────────────────────────────────
const DZECK_FILES_DIR = "/tmp/dzeck_files";
const DZECK_UPLOADS_DIR = "/tmp/dzeck_files/uploads";
if (!fs.existsSync(DZECK_FILES_DIR)) {
  fs.mkdirSync(DZECK_FILES_DIR, { recursive: true });
}
if (!fs.existsSync(DZECK_UPLOADS_DIR)) {
  fs.mkdirSync(DZECK_UPLOADS_DIR, { recursive: true });
}

// ─── Multer Upload Config ─────────────────────────────────────────────────────
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DZECK_UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${randomUUID().slice(0,8)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── E2B Cloud Sandbox (replaces VNC) ────────────────────────────────────────
const E2B_ENABLED = !!process.env.E2B_API_KEY;

if (E2B_ENABLED) {
  console.log("[E2B] Cloud sandbox mode enabled. Browser/shell tools run in isolated E2B environment.");
} else {
  console.warn("[E2B] E2B_API_KEY not set. Using local fallback for browser/shell tools.");
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

// Exported so index.ts can attach VNC WebSocket handling to extra port servers
export let handleVncUpgrade: ((req: any, socket: any, head: any) => void) | null = null;

export async function registerRoutes(app: any): Promise<Server> {
  const startupCfg = getCerebrasConfig();
  if (!startupCfg.apiKey) {
    console.warn("[WARNING] CEREBRAS_API_KEY is not set. AI features will not work.");
  }

  app.get("/status", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.get("/api/status", (_req: any, res: any) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), e2bEnabled: E2B_ENABLED });
  });

  // ─── Chat endpoint ─────────────────────────────────────────────────────────
  app.post("/api/chat", async (req: any, res: any) => {
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
    res.flushHeaders();

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
    eventQueue: string[];   // serialized SSE lines
    clients: Set<any>;      // active response objects
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
      try { client.write(line); } catch {}
    }
  }

  // ─── Agent endpoint with SSE ───────────────────────────────────────────────
  app.post("/api/agent", async (req: any, res: any) => {
    const { message, messages, attachments, session_id, resume_from_session, is_continuation } = req.body;
    if (!message && (!messages || !Array.isArray(messages))) {
      return res.status(400).json({ error: "message or messages array is required" });
    }

    setupSSEHeaders(res);

    const { apiKey, agentModel } = getCerebrasConfig();

    if (!apiKey) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "API key tidak dikonfigurasi. Set CEREBRAS_API_KEY di environment lalu restart server." })}\n\n`);
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    const sid = session_id || randomUUID();

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
        E2B_API_KEY: process.env.E2B_API_KEY || "",
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

    // Create session entry
    const session: AgentSession = {
      proc,
      eventQueue: [],
      clients: new Set([res]),
      done: false,
      startedAt: Date.now(),
      stderrBuffer: "",
    };
    activeAgentSessions.set(sid, session);

    // Send session event
    const sessionLine = `data: ${JSON.stringify({ type: "session", session_id: sid, e2b_enabled: E2B_ENABLED })}\n\n`;
    _broadcastToSession(session, sessionLine);

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
            _broadcastToSession(session, `data: ${JSON.stringify(parsed)}\n\n`);
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
      /aioredis/i, /pymongo/i, /socket\.gaierror/i, /\[agent\]/i];

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
    });

    // Client disconnects — keep proc alive, just remove client from session
    res.on("close", () => { session.clients.delete(res); });
  });

  // ─── Reconnect to existing agent session ──────────────────────────────────
  // ?replay=true  → replay all past events (default false to avoid duplicate chat messages)
  app.get("/api/agent/stream/:sid", (req: any, res: any) => {
    const { sid } = req.params;
    const replay = req.query.replay === "true";
    const session = activeAgentSessions.get(sid);
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired" });
    }
    setupSSEHeaders(res);

    session.clients.add(res);
    if (replay) {
      // Replay all queued events
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
  app.post("/api/agent/stop/:sid", (req: any, res: any) => {
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
      e2bEnabled: E2B_ENABLED,
    });
  });

  // ─── File Download endpoint ─────────────────────────────────────────────────
  // Serves files created by the AI agent (file_write, shell_exec output, etc.)
  // Supports all file types: zip, pdf, py, js, mp4, mp3, docx, xlsx, etc.
  app.get("/api/files/download", (req: any, res: any) => {
    const rawPath = req.query.path as string;
    const rawName = req.query.name as string;

    if (!rawPath) {
      return res.status(400).json({ error: "path is required" });
    }

    // Decode path
    let filePath: string;
    try {
      filePath = decodeURIComponent(rawPath);
    } catch {
      return res.status(400).json({ error: "invalid path encoding" });
    }

    // Security: only allow files in /tmp/dzeck_files/ (session-scoped file storage)
    if (filePath.includes("..")) {
      return res.status(403).json({ error: "access denied: path not allowed" });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }

    const realFilePath = fs.realpathSync(filePath);
    if (!realFilePath.startsWith("/tmp/dzeck_files/")) {
      return res.status(403).json({ error: "access denied: path not allowed" });
    }

    const stat = fs.lstatSync(realFilePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return res.status(400).json({ error: "path is not a regular file" });
    }

    const fileName = rawName ? decodeURIComponent(rawName) : path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase().slice(1);

    // MIME type map for common file types
    const MIME: Record<string, string> = {
      // Archives
      zip: "application/zip", rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed", tar: "application/x-tar",
      gz: "application/gzip", bz2: "application/x-bzip2", xz: "application/x-xz",
      iso: "application/x-iso9660-image",
      // Documents
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      odt: "application/vnd.oasis.opendocument.text",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      txt: "text/plain", md: "text/markdown", rtf: "application/rtf",
      csv: "text/csv", tsv: "text/tab-separated-values",
      // Data
      json: "application/json", xml: "application/xml",
      yaml: "application/x-yaml", yml: "application/x-yaml",
      toml: "application/toml", ini: "text/plain",
      sql: "application/sql", db: "application/x-sqlite3",
      sqlite: "application/x-sqlite3", sqlite3: "application/x-sqlite3",
      // Images
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif", bmp: "image/bmp", webp: "image/webp",
      svg: "image/svg+xml", ico: "image/x-icon",
      // Video
      mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo",
      mov: "video/quicktime", webm: "video/webm", flv: "video/x-flv",
      // Audio
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg",
      aac: "audio/aac", flac: "audio/flac", m4a: "audio/mp4",
      // Code
      py: "text/x-python", js: "text/javascript", ts: "text/typescript",
      tsx: "text/typescript", jsx: "text/javascript", html: "text/html",
      htm: "text/html", css: "text/css", sh: "text/x-shellscript",
      bash: "text/x-shellscript", java: "text/x-java-source",
      cpp: "text/x-c", c: "text/x-c", go: "text/x-go",
      rs: "text/x-rust", rb: "text/x-ruby", php: "text/x-php",
      // Binary
      exe: "application/x-msdownload", msi: "application/x-msinstaller",
      apk: "application/vnd.android.package-archive",
      deb: "application/x-debian-package", rpm: "application/x-rpm",
      wasm: "application/wasm",
    };

    const mimeType = MIME[ext] || "application/octet-stream";
    const fileSize = stat.size;

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", fileSize);
    res.setHeader("Cache-Control", "no-cache");

    const stream = fs.createReadStream(filePath);
    stream.on("error", (err) => {
      console.error("[FileDownload] Stream error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Failed to stream file" });
    });
    stream.pipe(res);
  });

  // ─── File Upload endpoint ────────────────────────────────────────────────────
  app.post("/api/upload", (req: any, res: any, next: any) => {
    upload.array("files", 10)(req, res, (multerErr: any) => {
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
        if (!fs.existsSync(DZECK_UPLOADS_DIR)) {
          fs.mkdirSync(DZECK_UPLOADS_DIR, { recursive: true });
        }
        const result = files.map((f: any) => {
          const filePath = f.path;
          const fileName = f.originalname;
          const mime = f.mimetype || "application/octet-stream";
          const size = f.size;
          const isImage = mime.startsWith("image/");
          const isText = mime.startsWith("text/") || /\.(txt|md|py|js|ts|json|csv|xml|html|css|sh|yaml|yml|toml|ini|log)$/i.test(fileName);
          let preview: string | null = null;
          if (isText && size < 500 * 1024) {
            try { preview = fs.readFileSync(filePath, "utf-8"); } catch {}
          }
          return {
            filename: fileName,
            path: filePath,
            mime,
            size,
            is_image: isImage,
            is_text: isText,
            preview,
            download_url: `/api/files/download?path=${encodeURIComponent(filePath)}&name=${encodeURIComponent(fileName)}`,
          };
        });
        res.json({ files: result });
      } catch (err: any) {
        res.status(500).json({ error: "Upload gagal: " + err.message });
      }
    });
  });

  // ─── File list endpoint (files created by AI) ───────────────────────────────
  app.get("/api/files/list", (_req: any, res: any) => {
    try {
      if (!fs.existsSync(DZECK_FILES_DIR)) {
        return res.json({ files: [] });
      }
      const files = fs.readdirSync(DZECK_FILES_DIR).map(name => {
        const full = path.join(DZECK_FILES_DIR, name);
        const stat = fs.statSync(full);
        return {
          name,
          size: stat.size,
          created: stat.birthtime,
          download_url: `/api/files/download?path=${encodeURIComponent(full)}&name=${encodeURIComponent(name)}`,
        };
      });
      res.json({ files });
    } catch (e) {
      res.json({ files: [] });
    }
  });

  // ─── VNC start/manage (managed by Node.js server) ───────────────────────
  const _vncProcs: any[] = [];
  let _vncStarted = false;
  let _vncStarting = false;
  const VNC_DISPLAY = ":10";
  const VNC_PORT_NUM = 5910;
  const VNC_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
  let _vncLastActivity = Date.now();
  let _vncIdleTimer: ReturnType<typeof setTimeout> | null = null;
  let _chromiumProc: any = null;
  const CDP_PORT = 9222;

  function vncTouch() {
    _vncLastActivity = Date.now();
    if (_vncIdleTimer) { clearTimeout(_vncIdleTimer); _vncIdleTimer = null; }
    _vncIdleTimer = setTimeout(() => {
      if (Date.now() - _vncLastActivity >= VNC_IDLE_TIMEOUT_MS - 1000) {
        console.log("[VNC] Idle timeout (10min) — shutting down VNC display");
        stopVnc();
      }
    }, VNC_IDLE_TIMEOUT_MS);
  }

  function stopVnc() {
    if (_chromiumProc) {
      try { _chromiumProc.kill("SIGTERM"); } catch {}
      _chromiumProc = null;
    }
    for (const p of _vncProcs) {
      try { p.kill("SIGTERM"); } catch {}
    }
    _vncProcs.length = 0;
    _vncStarted = false;
    if (_vncIdleTimer) { clearTimeout(_vncIdleTimer); _vncIdleTimer = null; }
    try {
      execSync("pkill -f 'chromium.*--remote-debugging-port' 2>/dev/null; true", { timeout: 3000 });
    } catch {}
    delete process.env.DZECK_CDP_URL;
    console.log("[VNC] Display stopped (including persistent Chromium)");
  }

  // Set DISPLAY early so agent/browser requests never start headless
  process.env.DISPLAY = VNC_DISPLAY;
  process.env.DZECK_VNC_DISPLAY = VNC_DISPLAY;

  let _vncStartPromise: Promise<boolean> | null = null;

  // ─── Launch (or re-launch) persistent Chromium — can be called independently ─
  async function launchChromiumOnly(): Promise<void> {
    // Kill any stale Chromium
    if (_chromiumProc) {
      try { _chromiumProc.kill("SIGTERM"); } catch {}
      _chromiumProc = null;
    }
    try { execSync("pkill -f 'chromium.*--remote-debugging-port' 2>/dev/null; true", { timeout: 3000 }); } catch {}
    delete process.env.DZECK_CDP_URL;
    await new Promise(r => setTimeout(r, 500));

    // ── Find a working Chromium binary ──────────────────────────────────────
    // Priority order:
    //  1. NixOS-packaged Chromium (ungoogled-chromium) — properly rpath-patched,
    //     works without LD_LIBRARY_PATH. Found in nix store.
    //  2. Playwright's bundled Chrome — only works if LD_LIBRARY_PATH is set
    //     (breaks on stock NixOS because shared libs aren't in standard paths).
    //  3. Any system chromium/google-chrome on PATH.
    let chromiumExe = "";

    // 1. Nix-packaged Chromium — check known fixed paths first (fast fs.existsSync),
    //    these are properly rpath-patched and work without LD_LIBRARY_PATH on NixOS.
    const NIX_CHROMIUM_CANDIDATES = [
      // Discovered at runtime — ungoogled-chromium versions available in this environment
      "/nix/store/43y6k6fj85l4kcd1yan43hpdld6nmjmp-ungoogled-chromium-131.0.6778.204/bin/chromium",
      "/nix/store/22pqil8ywhgwx1vdnkhr19gmaziyfc99-ungoogled-chromium-98.0.4758.102/bin/chromium",
      "/nix/store/2rx3w289sarzpmnpfywyg2xvpjwj91yc-ungoogled-chromium-92.0.4515.159/bin/chromium",
    ];
    for (const candidate of NIX_CHROMIUM_CANDIDATES) {
      if (fs.existsSync(candidate)) { chromiumExe = candidate; break; }
    }

    // 2. Playwright bundled Chrome
    if (!chromiumExe) {
      try {
        const pwCacheBase = path.join(process.cwd(), ".cache", "ms-playwright");
        const dirs = fs.readdirSync(pwCacheBase).filter((d: string) => d.startsWith("chromium-")).sort().reverse();
        for (const d of dirs) {
          const c1 = path.join(pwCacheBase, d, "chrome-linux64", "chrome");
          if (fs.existsSync(c1)) { chromiumExe = c1; break; }
          const c2 = path.join(pwCacheBase, d, "chrome-linux", "chrome");
          if (fs.existsSync(c2)) { chromiumExe = c2; break; }
        }
      } catch {}
    }

    // 3. System PATH fallback
    if (!chromiumExe) {
      try {
        chromiumExe = execSync(
          "which chromium 2>/dev/null || which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null",
          { encoding: "utf-8", timeout: 2000 }
        ).trim();
      } catch {}
    }

    if (!chromiumExe) {
      console.warn("[VNC] No Chromium binary found — browser will launch per-agent-session");
      return;
    }
    console.log(`[VNC] Using Chromium: ${chromiumExe}`);

    _chromiumProc = spawn(chromiumExe, [
      "--no-sandbox", "--disable-dev-shm-usage", "--disable-setuid-sandbox",
      "--disable-gpu",
      // NOTE: --disable-software-rasterizer intentionally removed.
      // Chromium needs software rasterizer when GPU is unavailable (no /dev/dri).
      // Combining --disable-gpu with --disable-software-rasterizer causes an
      // immediate crash because there is no remaining rendering path.
      "--disable-extensions",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--no-first-run", "--no-default-browser-check",
      "--disable-sync", "--disable-default-apps",
      "--disable-infobars", "--disable-popup-blocking",
      "--disable-translate", "--disable-notifications",
      "--disable-component-update",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=TranslateUI,InfiniteSessionRestore,MediaRouter,OptimizationHints",
      "--autoplay-policy=no-user-gesture-required",
      "--password-store=basic", "--use-mock-keychain",
      "--window-size=1280,720", "--window-position=0,0",
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=/tmp/dzeck-chrome-data-${Date.now()}`,
      "http://127.0.0.1:5000/vnc-splash",
    ], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, DISPLAY: VNC_DISPLAY },
    });
    _chromiumProc.unref();

    // Wait and verify Chromium didn't crash immediately
    await new Promise(r => setTimeout(r, 2500));
    if (_chromiumProc.exitCode !== null) {
      console.error(`[VNC] Chromium crashed on launch (exitCode: ${_chromiumProc.exitCode}) — check binary or flags`);
      _chromiumProc = null;
      delete process.env.DZECK_CDP_URL;
      return;
    }
    process.env.DZECK_CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
    console.log(`[VNC] Chromium launched (CDP port ${CDP_PORT}, exe: ${chromiumExe})`);
  }

  async function ensureVncRunning(): Promise<boolean> {
    if (_vncStarted) {
      const allAlive = _vncProcs.every((p: any) => p.exitCode === null);
      const chromiumAlive = _chromiumProc && _chromiumProc.exitCode === null;
      if (allAlive && chromiumAlive) {
        try {
          await new Promise<void>((resolve, reject) => {
            const req = nodeHttp.get(`http://127.0.0.1:${CDP_PORT}/json/version`, { timeout: 3000 }, (res: any) => {
              res.resume();
              res.on("end", () => resolve());
            });
            req.on("error", () => reject(new Error("CDP probe failed")));
            req.on("timeout", () => { req.destroy(); reject(new Error("CDP probe timeout")); });
          });
          return true;
        } catch {
          console.log("[VNC] CDP health probe failed — Chromium hung, restarting Chromium only...");
          await launchChromiumOnly();
          vncTouch();
          return true;
        }
      } else if (allAlive && !chromiumAlive) {
        // VNC stack (Xvfb + x11vnc + fluxbox) is healthy — only Chromium crashed.
        // Restart ONLY Chromium instead of tearing down the entire display stack.
        console.log("[VNC] Chromium crashed but VNC display is alive — restarting Chromium only...");
        await launchChromiumOnly();
        vncTouch();
        return true;
      } else {
        // Xvfb or x11vnc itself died — need full stack restart
        console.log(`[VNC] VNC display stack dead (allAlive=${allAlive}) — full restart...`);
        stopVnc();
      }
    }
    if (_vncStarting && _vncStartPromise) {
      return _vncStartPromise;
    }
    _vncStarting = true;

    const doStart = async (): Promise<boolean> => {
    try {
      const spawnProc = spawn;

      // Fast binary lookup: only use `which` (respects PATH) with known fallbacks
      const findBin = (name: string, fallback: string | null = null): string => {
        try {
          const p = execSync(`which ${name} 2>/dev/null`, { encoding: "utf-8", timeout: 2000 }).trim();
          if (p) return p;
        } catch {}
        return fallback !== null ? fallback : name;
      };

      // Use known nix store paths as fallbacks (from environment introspection)
      const xvfb = findBin("Xvfb", "/nix/store/8jlz3l9kf9w7zq263vy3ms5c90hy96r4-xorg-server-21.1.13/bin/Xvfb");
      const x11vnc = findBin("x11vnc", "/nix/store/x15ycm43gka3mkj8lxy14mv8iazxk60s-x11vnc-0.9.16/bin/x11vnc");

      console.log(`[VNC] Binaries: Xvfb=${xvfb} x11vnc=${x11vnc}`);

      // Kill any stale processes on the display/port before starting
      try { execSync(`pkill -f "Xvfb ${VNC_DISPLAY}" 2>/dev/null; true`); } catch {}
      try { execSync(`pkill -f "x11vnc.*${VNC_PORT_NUM}" 2>/dev/null; true`); } catch {}
      try { execSync(`pkill -f "chromium.*--remote-debugging-port" 2>/dev/null; true`); } catch {}
      await new Promise(r => setTimeout(r, 1000));

      // Remove stale X lock files so Xvfb can start fresh
      const displayNum = VNC_DISPLAY.replace(":", "");
      const cleanLocks = () => {
        try {
          const lockFile = `/tmp/.X${displayNum}-lock`;
          const socketFile = `/tmp/.X11-unix/X${displayNum}`;
          if (fs.existsSync(lockFile)) { fs.unlinkSync(lockFile); console.log(`[VNC] Removed stale lock: ${lockFile}`); }
          if (fs.existsSync(socketFile)) { fs.unlinkSync(socketFile); console.log(`[VNC] Removed stale socket: ${socketFile}`); }
        } catch (e: any) { console.warn("[VNC] Lock cleanup warning:", e.message); }
      };
      cleanLocks();

      // 1. Start Xvfb with retry
      let xvfbProc: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        xvfbProc = spawnProc(xvfb, [VNC_DISPLAY, "-screen", "0", "1280x720x24", "-ac", "-nolisten", "tcp"], {
          detached: false, stdio: "ignore",
          env: { ...process.env },
        });
        await new Promise(r => setTimeout(r, 2000));
        if (xvfbProc.exitCode === null) {
          break;
        }
        console.warn(`[VNC] Xvfb attempt ${attempt}/3 failed, cleaning up and retrying...`);
        try { execSync(`pkill -f "Xvfb ${VNC_DISPLAY}" 2>/dev/null; true`); } catch {}
        await new Promise(r => setTimeout(r, 500));
        cleanLocks();
        await new Promise(r => setTimeout(r, 500));
      }
      if (!xvfbProc || xvfbProc.exitCode !== null) {
        console.error("[VNC] Xvfb failed to start after 3 attempts");
        _vncStarting = false; return false;
      }
      _vncProcs.push(xvfbProc);

      // 2. Draw solid background so display isn't black
      const xsetroot = findBin("xsetroot", "");
      if (xsetroot) {
        try {
          spawnProc(xsetroot, ["-solid", "#2d2d44"], {
            detached: false, stdio: "ignore",
            env: { ...process.env, DISPLAY: VNC_DISPLAY },
          });
          console.log("[VNC] Background set via xsetroot");
        } catch {}
      }

      // 3. Start x11vnc on VNC_PORT_NUM (avoids conflict with any system :5900)
      let x11vncProc: any = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        x11vncProc = spawnProc(x11vnc, [
          "-display", VNC_DISPLAY, "-forever", "-shared", "-nopw",
          "-rfbport", String(VNC_PORT_NUM),
          "-noxdamage", "-cursor", "arrow",
          "-xkb", "-noxrecord", "-noxfixes",
          "-nowf", "-norc",
          "-quiet",
        ], {
          detached: false, stdio: "ignore",
          env: { ...process.env, DISPLAY: VNC_DISPLAY },
        });
        await new Promise(r => setTimeout(r, 2000));
        if (x11vncProc.exitCode === null) {
          break;
        }
        console.warn(`[VNC] x11vnc attempt ${attempt}/3 failed, retrying...`);
        try { execSync(`fuser -k ${VNC_PORT_NUM}/tcp 2>/dev/null; true`, { timeout: 2000 }); } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!x11vncProc || x11vncProc.exitCode !== null) {
        console.error("[VNC] x11vnc failed to start after 3 attempts");
        _vncStarting = false; return false;
      }
      _vncProcs.push(x11vncProc);

      // 4. Set DISPLAY for Playwright and sub-processes
      process.env.DISPLAY = VNC_DISPLAY;
      process.env.DZECK_VNC_DISPLAY = VNC_DISPLAY;

      // 5. Start a lightweight window manager (fluxbox) in kiosk mode
      const fluxbox = findBin("fluxbox", "");
      if (fluxbox) {
        try {
          const fbDir = path.join(process.env.HOME || "/home/runner", ".fluxbox");
          if (!fs.existsSync(fbDir)) fs.mkdirSync(fbDir, { recursive: true });

          fs.writeFileSync(path.join(fbDir, "init"), [
            "session.screen0.toolbar.visible: false",
            "session.screen0.toolbar.autoHide: true",
            "session.screen0.toolbar.widthPercent: 0",
            "session.screen0.slit.autoHide: true",
            "session.screen0.defaultDeco: NONE",
            "session.screen0.workspaces: 1",
            "session.screen0.window.focus.alpha: 255",
            "session.screen0.window.unfocus.alpha: 255",
            "session.screen0.tabs.usePixmap: false",
            "session.screen0.focusModel: MouseFocus",
            "session.screen0.autoRaise: true",
            "session.screen0.clickRaises: true",
            "session.styleFile: /dev/null",
          ].join("\n") + "\n");

          fs.writeFileSync(path.join(fbDir, "apps"), [
            "[app] (name=.*) (class=.*)",
            "  [Maximized] {yes}",
            "  [Deco] {NONE}",
            "  [Dimensions] {1280 720}",
            "  [Position] {0 0}",
            "[end]",
          ].join("\n") + "\n");

          const fbProc = spawnProc(fluxbox, [], {
            detached: false, stdio: "ignore",
            env: { ...process.env, DISPLAY: VNC_DISPLAY },
          });
          _vncProcs.push(fbProc);
          await new Promise(r => setTimeout(r, 1000));
          console.log("[VNC] Fluxbox window manager started (kiosk mode)");
        } catch {}
      }

      // 6. Launch persistent Chromium (delegated to launchChromiumOnly())
      await launchChromiumOnly();

      _vncStarted = true;
      _vncStarting = false;
      _vncStartPromise = null;
      vncTouch();
      console.log(`[VNC] Stack ready: DISPLAY=${VNC_DISPLAY} VNC_PORT=${VNC_PORT_NUM} (idle timeout: 10min)`);
      return true;
    } catch (err: any) {
      console.error("[VNC] Failed to start:", err.message);
      _vncStarting = false;
      _vncStartPromise = null;
      return false;
    }
    };

    _vncStartPromise = doStart();
    return _vncStartPromise;
  }

  app.post("/api/vnc/start", async (_req: any, res: any) => {
    const started = await ensureVncRunning();
    res.json({ started });
  });

  // ─── VNC splash page — shown by Chromium on launch instead of about:blank ─
  // Gives a branded dark screen so VNC never looks "black/empty".
  app.get("/vnc-splash", (_req: any, res: any) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<title>Dzeck AI — Browser Siap</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body { width:100%; height:100%; background:#0f0f1a; color:#c8c8e8;
    font-family: 'Segoe UI', system-ui, sans-serif; overflow:hidden; }
  .center { display:flex; flex-direction:column; align-items:center;
    justify-content:center; height:100vh; gap:20px; }
  .logo { font-size:48px; font-weight:700; letter-spacing:2px;
    background:linear-gradient(135deg,#7c3aed,#4f46e5,#06b6d4);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
  .sub { font-size:16px; color:#6b7280; letter-spacing:1px; }
  .dot { display:inline-block; width:8px; height:8px; border-radius:50%;
    background:#7c3aed; margin:0 3px; animation:pulse 1.4s ease-in-out infinite; }
  .dot:nth-child(2){ animation-delay:.2s; }
  .dot:nth-child(3){ animation-delay:.4s; }
  @keyframes pulse { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
  .status { font-size:13px; color:#4b5563; margin-top:8px; }
</style>
</head>
<body>
<div class="center">
  <div class="logo">Dzeck AI</div>
  <div class="sub">Browser siap &bull; Menunggu instruksi agent</div>
  <div style="margin-top:4px">
    <span class="dot"></span><span class="dot"></span><span class="dot"></span>
  </div>
  <div class="status">CDP port 9222 aktif &bull; Ketik tugas di chat untuk memulai</div>
</div>
</body>
</html>`);
  });

  // ─── VNC viewer HTML page (loaded by React Native WebView) ───────────────
  app.get("/vnc-view", (_req: any, res: any) => {
    const html = path.join(__dirname, "templates", "vnc-view.html");
    if (fs.existsSync(html)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(html);
    } else {
      res.status(404).send("vnc-view.html not found");
    }
  });

  // ─── VNC status endpoint ──────────────────────────────────────────────────
  app.get("/api/vnc/status", (_req: any, res: any) => {
    const wsPort = 6081;
    const vncPort = VNC_PORT_NUM;
    const idleMs = Date.now() - _vncLastActivity;
    const remainMs = Math.max(0, VNC_IDLE_TIMEOUT_MS - idleMs);
    const tcpCheck = net.createConnection({ port: vncPort, host: "127.0.0.1" });
    tcpCheck.setTimeout(800);
    tcpCheck.on("connect", () => {
      tcpCheck.destroy();
      res.json({ ready: true, ws_port: wsPort, vnc_port: vncPort, idle_ms: idleMs, remaining_ms: remainMs });
    });
    tcpCheck.on("error", () => {
      res.json({ ready: false, ws_port: wsPort, vnc_port: vncPort, idle_ms: idleMs, remaining_ms: remainMs });
    });
    tcpCheck.on("timeout", () => {
      tcpCheck.destroy();
      res.json({ ready: false, ws_port: wsPort, vnc_port: vncPort, idle_ms: idleMs, remaining_ms: remainMs });
    });
  });

  const httpServer = createServer(app);

  // ─── Auto-start VNC at server boot so DISPLAY is set for all agent requests ─
  setImmediate(() => {
    ensureVncRunning().then((ok) => {
      if (ok) {
        console.log("[VNC] Auto-started VNC stack at server boot — browser will use display :10");
      } else {
        console.warn("[VNC] Auto-start failed — VNC display may be unavailable");
      }
    }).catch((e: any) => {
      console.warn("[VNC] Auto-start error:", e?.message);
    });
  });

  // ─── WebSocket proxy for VNC (/vnc-ws → raw TCP :5910) ─────────────────
  // Native Node.js WS→TCP proxy — no websockify needed.
  // noVNC sends binary RFB protocol over WebSocket; we relay it directly to x11vnc.
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (clientWs: any, _req: any) => {
    vncTouch();
    console.log(`[VNC-WS] Client connected → proxying to VNC TCP:${VNC_PORT_NUM}`);

    const vncSocket = net.createConnection({ port: VNC_PORT_NUM, host: "127.0.0.1" });

    vncSocket.on("connect", () => {
      console.log(`[VNC-WS] TCP connected to x11vnc:${VNC_PORT_NUM} ✓`);
    });

    // Relay: WebSocket client → VNC TCP socket
    clientWs.on("message", (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
      if (vncSocket.writable) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        vncSocket.write(buf);
      }
    });

    // Relay: VNC TCP socket → WebSocket client
    vncSocket.on("data", (data: Buffer) => {
      if (clientWs.readyState === 1 /* OPEN */) {
        clientWs.send(data, { binary: true });
      }
    });

    const cleanup = () => {
      try { if (clientWs.readyState !== 3) clientWs.close(); } catch {}
      try { vncSocket.destroy(); } catch {}
    };

    vncSocket.on("error", (err: Error) => {
      console.error("[VNC-WS] TCP error:", err.message);
      cleanup();
    });

    vncSocket.on("close", () => {
      console.log("[VNC-WS] VNC TCP connection closed");
      cleanup();
    });

    clientWs.on("error", () => cleanup());
    clientWs.on("close", () => {
      console.log("[VNC-WS] Browser client disconnected");
      cleanup();
    });
  });

  // Shared upgrade handler — also applied to extra-port servers in index.ts
  handleVncUpgrade = (req: any, socket: any, head: any) => {
    const url = req.url || "";
    if (url.startsWith("/vnc-ws")) {
      wss.handleUpgrade(req, socket, head, (ws: any) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  };

  httpServer.on("upgrade", handleVncUpgrade);

  return httpServer;
}
