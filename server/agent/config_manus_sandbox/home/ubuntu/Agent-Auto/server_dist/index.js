var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// server/index.ts
import express from "express";

// server/routes.ts
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import * as https from "node:https";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { WebSocketServer } from "ws";
var DZECK_FILES_DIR = "/tmp/dzeck_files";
var DZECK_UPLOADS_DIR = "/tmp/dzeck_files/uploads";
if (!fs.existsSync(DZECK_FILES_DIR)) {
  fs.mkdirSync(DZECK_FILES_DIR, { recursive: true });
}
if (!fs.existsSync(DZECK_UPLOADS_DIR)) {
  fs.mkdirSync(DZECK_UPLOADS_DIR, { recursive: true });
}
var upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DZECK_UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${randomUUID().slice(0, 8)}${ext}`);
    }
  }),
  limits: { fileSize: 50 * 1024 * 1024 }
});
var E2B_ENABLED = !!process.env.E2B_API_KEY;
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
function setupSSEHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
}
var handleVncUpgrade = null;
async function registerRoutes(app2) {
  const startupCfg = getCerebrasConfig();
  if (!startupCfg.apiKey) {
    console.warn("[WARNING] CEREBRAS_API_KEY is not set. AI features will not work.");
  }
  app2.get("/status", (_req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app2.get("/api/status", (_req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString(), e2bEnabled: E2B_ENABLED });
  });
  app2.post("/api/chat", async (req, res) => {
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
    const requestBody = JSON.stringify({ model, messages, stream: true, max_tokens: 8192, temperature: 0.7, top_p: 1 });
    const options = {
      hostname,
      port: 443,
      path: apiPath,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    };
    setupSSEHeaders(res);
    res.flushHeaders();
    const apiReq = https.request(options, (apiRes) => {
      if (apiRes.statusCode !== 200) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "AI service error " + apiRes.statusCode })}\n\n`);
        return res.end();
      }
      let buffer = "";
      apiRes.on("data", (chunk) => {
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
  app2.post("/api/agent", (req, res) => {
    const { message, messages, attachments, session_id, resume_from_session } = req.body;
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
        E2B_API_KEY: process.env.E2B_API_KEY || ""
      }
    });
    proc.stdin.write(JSON.stringify({
      message: message || "",
      messages: messages || [],
      model: agentModel,
      attachments: attachments || [],
      session_id: sid,
      resume_from_session: resume_from_session || null
    }));
    proc.stdin.end();
    let buf = "";
    let doneSent = false;
    let stderrBuffer = "";
    res.write(`data: ${JSON.stringify({ type: "session", session_id: sid, e2b_enabled: E2B_ENABLED })}

`);
    proc.stdout.on("data", (data) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "done") {
            doneSent = true;
            res.write("data: [DONE]\n\n");
          } else res.write(`data: ${JSON.stringify(parsed)}

`);
        } catch {
        }
      }
    });
    proc.stderr.on("data", (data) => {
      stderrBuffer += data.toString();
      console.error("[Agent stderr]:", data.toString());
    });
    proc.on("close", (code) => {
      if (code !== 0 && stderrBuffer && !doneSent && !res.writableEnded) {
        const BENIGN = [
          /redis/i,
          /mongodb/i,
          /motor/i,
          /DNS/i,
          /Name or service not known/i,
          /ConnectionRefusedError/i,
          /\[CacheStore\]/i,
          /\[SessionStore\]/i,
          /\[SessionService\]/i,
          /WARNING:/i,
          /DeprecationWarning/i,
          /connection failed/i,
          /Traceback/i,
          /aioredis/i,
          /pymongo/i,
          /socket\.gaierror/i,
          /\[agent\]/i
        ];
        const hasRealError = !BENIGN.some((p) => p.test(stderrBuffer));
        if (hasRealError) {
          res.write(`data: ${JSON.stringify({ type: "error", error: "Agen mengalami kesalahan internal. Silakan coba lagi." })}

`);
        }
      }
      if (!doneSent && !res.writableEnded) res.write("data: [DONE]\n\n");
      res.end();
      if (code !== 0) console.error(`Agent process exited with code ${code}. Stderr: ${stderrBuffer.slice(-500)}`);
    });
    res.on("close", () => {
      proc.kill();
    });
  });
  app2.get("/api/test", (_req, res) => {
    res.json({
      message: "API is working",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      cerebrasConfigured: !!startupCfg.apiKey,
      e2bEnabled: E2B_ENABLED
    });
  });
  app2.get("/api/files/download", (req, res) => {
    const rawPath = req.query.path;
    const rawName = req.query.name;
    if (!rawPath) {
      return res.status(400).json({ error: "path is required" });
    }
    let filePath;
    try {
      filePath = decodeURIComponent(rawPath);
    } catch {
      return res.status(400).json({ error: "invalid path encoding" });
    }
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
    const MIME = {
      // Archives
      zip: "application/zip",
      rar: "application/x-rar-compressed",
      "7z": "application/x-7z-compressed",
      tar: "application/x-tar",
      gz: "application/gzip",
      bz2: "application/x-bzip2",
      xz: "application/x-xz",
      iso: "application/x-iso9660-image",
      // Documents
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      odt: "application/vnd.oasis.opendocument.text",
      ods: "application/vnd.oasis.opendocument.spreadsheet",
      txt: "text/plain",
      md: "text/markdown",
      rtf: "application/rtf",
      csv: "text/csv",
      tsv: "text/tab-separated-values",
      // Data
      json: "application/json",
      xml: "application/xml",
      yaml: "application/x-yaml",
      yml: "application/x-yaml",
      toml: "application/toml",
      ini: "text/plain",
      sql: "application/sql",
      db: "application/x-sqlite3",
      sqlite: "application/x-sqlite3",
      sqlite3: "application/x-sqlite3",
      // Images
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      bmp: "image/bmp",
      webp: "image/webp",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      // Video
      mp4: "video/mp4",
      mkv: "video/x-matroska",
      avi: "video/x-msvideo",
      mov: "video/quicktime",
      webm: "video/webm",
      flv: "video/x-flv",
      // Audio
      mp3: "audio/mpeg",
      wav: "audio/wav",
      ogg: "audio/ogg",
      aac: "audio/aac",
      flac: "audio/flac",
      m4a: "audio/mp4",
      // Code
      py: "text/x-python",
      js: "text/javascript",
      ts: "text/typescript",
      tsx: "text/typescript",
      jsx: "text/javascript",
      html: "text/html",
      htm: "text/html",
      css: "text/css",
      sh: "text/x-shellscript",
      bash: "text/x-shellscript",
      java: "text/x-java-source",
      cpp: "text/x-c",
      c: "text/x-c",
      go: "text/x-go",
      rs: "text/x-rust",
      rb: "text/x-ruby",
      php: "text/x-php",
      // Binary
      exe: "application/x-msdownload",
      msi: "application/x-msinstaller",
      apk: "application/vnd.android.package-archive",
      deb: "application/x-debian-package",
      rpm: "application/x-rpm",
      wasm: "application/wasm"
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
  app2.post("/api/upload", (req, res, next) => {
    upload.array("files", 10)(req, res, (multerErr) => {
      if (multerErr) {
        const msg = multerErr.code === "LIMIT_FILE_SIZE" ? "File terlalu besar (max 50MB)" : multerErr.message || "Upload gagal";
        return res.status(400).json({ error: msg });
      }
      try {
        const files = req.files || [];
        if (files.length === 0) {
          return res.status(400).json({ error: "Tidak ada file yang diunggah" });
        }
        if (!fs.existsSync(DZECK_UPLOADS_DIR)) {
          fs.mkdirSync(DZECK_UPLOADS_DIR, { recursive: true });
        }
        const result = files.map((f) => {
          const filePath = f.path;
          const fileName = f.originalname;
          const mime = f.mimetype || "application/octet-stream";
          const size = f.size;
          const isImage = mime.startsWith("image/");
          const isText = mime.startsWith("text/") || /\.(txt|md|py|js|ts|json|csv|xml|html|css|sh|yaml|yml|toml|ini|log)$/i.test(fileName);
          let preview = null;
          if (isText && size < 500 * 1024) {
            try {
              preview = fs.readFileSync(filePath, "utf-8");
            } catch {
            }
          }
          return {
            filename: fileName,
            path: filePath,
            mime,
            size,
            is_image: isImage,
            is_text: isText,
            preview,
            download_url: `/api/files/download?path=${encodeURIComponent(filePath)}&name=${encodeURIComponent(fileName)}`
          };
        });
        res.json({ files: result });
      } catch (err) {
        res.status(500).json({ error: "Upload gagal: " + err.message });
      }
    });
  });
  app2.get("/api/files/list", (_req, res) => {
    try {
      if (!fs.existsSync(DZECK_FILES_DIR)) {
        return res.json({ files: [] });
      }
      const files = fs.readdirSync(DZECK_FILES_DIR).map((name) => {
        const full = path.join(DZECK_FILES_DIR, name);
        const stat = fs.statSync(full);
        return {
          name,
          size: stat.size,
          created: stat.birthtime,
          download_url: `/api/files/download?path=${encodeURIComponent(full)}&name=${encodeURIComponent(name)}`
        };
      });
      res.json({ files });
    } catch (e) {
      res.json({ files: [] });
    }
  });
  const _vncProcs = [];
  let _vncStarted = false;
  let _vncStarting = false;
  const VNC_DISPLAY = ":10";
  const VNC_PORT_NUM = 5910;
  const VNC_IDLE_TIMEOUT_MS = 10 * 60 * 1e3;
  let _vncLastActivity = Date.now();
  let _vncIdleTimer = null;
  let _chromiumProc = null;
  const CDP_PORT = 9222;
  function vncTouch() {
    _vncLastActivity = Date.now();
    if (_vncIdleTimer) {
      clearTimeout(_vncIdleTimer);
      _vncIdleTimer = null;
    }
    _vncIdleTimer = setTimeout(() => {
      if (Date.now() - _vncLastActivity >= VNC_IDLE_TIMEOUT_MS - 1e3) {
        console.log("[VNC] Idle timeout (10min) \u2014 shutting down VNC display");
        stopVnc();
      }
    }, VNC_IDLE_TIMEOUT_MS);
  }
  function stopVnc() {
    if (_chromiumProc) {
      try {
        _chromiumProc.kill("SIGTERM");
      } catch {
      }
      _chromiumProc = null;
    }
    for (const p of _vncProcs) {
      try {
        p.kill("SIGTERM");
      } catch {
      }
    }
    _vncProcs.length = 0;
    _vncStarted = false;
    if (_vncIdleTimer) {
      clearTimeout(_vncIdleTimer);
      _vncIdleTimer = null;
    }
    try {
      const { execSync } = __require("node:child_process");
      execSync("pkill -f 'chromium.*--remote-debugging-port' 2>/dev/null; true", { timeout: 3e3 });
    } catch {
    }
    delete process.env.DZECK_CDP_URL;
    console.log("[VNC] Display stopped (including persistent Chromium)");
  }
  process.env.DISPLAY = VNC_DISPLAY;
  process.env.DZECK_VNC_DISPLAY = VNC_DISPLAY;
  async function ensureVncRunning() {
    if (_vncStarted) {
      const allAlive = _vncProcs.every((p) => p.exitCode === null);
      if (allAlive) return true;
      _vncStarted = false;
      _vncProcs.length = 0;
    }
    if (_vncStarting) {
      return new Promise((resolve2) => setTimeout(() => resolve2(_vncStarted), 5e3));
    }
    _vncStarting = true;
    try {
      const { spawn: spawnProc, execSync } = __require("node:child_process");
      const findBin = (name, fallback = null) => {
        try {
          const p = execSync(`which ${name} 2>/dev/null`, { encoding: "utf-8", timeout: 2e3 }).trim();
          if (p) return p;
        } catch {
        }
        return fallback !== null ? fallback : name;
      };
      const xvfb = findBin("Xvfb", "/nix/store/8jlz3l9kf9w7zq263vy3ms5c90hy96r4-xorg-server-21.1.13/bin/Xvfb");
      const x11vnc = findBin("x11vnc", "/nix/store/x15ycm43gka3mkj8lxy14mv8iazxk60s-x11vnc-0.9.16/bin/x11vnc");
      console.log(`[VNC] Binaries: Xvfb=${xvfb} x11vnc=${x11vnc}`);
      try {
        execSync(`pkill -f "Xvfb ${VNC_DISPLAY}" 2>/dev/null; true`);
      } catch {
      }
      try {
        execSync(`pkill -f "x11vnc.*${VNC_PORT_NUM}" 2>/dev/null; true`);
      } catch {
      }
      await new Promise((r) => setTimeout(r, 800));
      const displayNum = VNC_DISPLAY.replace(":", "");
      try {
        const lockFile = `/tmp/.X${displayNum}-lock`;
        const socketFile = `/tmp/.X11-unix/X${displayNum}`;
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
          console.log(`[VNC] Removed stale lock: ${lockFile}`);
        }
        if (fs.existsSync(socketFile)) {
          fs.unlinkSync(socketFile);
          console.log(`[VNC] Removed stale socket: ${socketFile}`);
        }
      } catch (e) {
        console.warn("[VNC] Lock cleanup warning:", e.message);
      }
      const xvfbProc = spawnProc(xvfb, [VNC_DISPLAY, "-screen", "0", "1280x720x24", "-ac", "-nolisten", "tcp"], {
        detached: false,
        stdio: "ignore",
        env: { ...process.env }
      });
      _vncProcs.push(xvfbProc);
      await new Promise((r) => setTimeout(r, 2e3));
      if (xvfbProc.exitCode !== null) {
        console.error("[VNC] Xvfb failed to start");
        _vncStarting = false;
        return false;
      }
      const xsetroot = findBin("xsetroot", "");
      if (xsetroot) {
        try {
          spawnProc(xsetroot, ["-solid", "#2d2d44"], {
            detached: false,
            stdio: "ignore",
            env: { ...process.env, DISPLAY: VNC_DISPLAY }
          });
          console.log("[VNC] Background set via xsetroot");
        } catch {
        }
      }
      const x11vncProc = spawnProc(x11vnc, [
        "-display",
        VNC_DISPLAY,
        "-forever",
        "-shared",
        "-nopw",
        "-rfbport",
        String(VNC_PORT_NUM),
        "-noxdamage",
        "-cursor",
        "arrow",
        "-quiet"
      ], {
        detached: false,
        stdio: "ignore",
        env: { ...process.env, DISPLAY: VNC_DISPLAY }
      });
      _vncProcs.push(x11vncProc);
      await new Promise((r) => setTimeout(r, 2e3));
      if (x11vncProc.exitCode !== null) {
        console.error("[VNC] x11vnc failed to start");
        _vncStarting = false;
        return false;
      }
      process.env.DISPLAY = VNC_DISPLAY;
      process.env.DZECK_VNC_DISPLAY = VNC_DISPLAY;
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
            "session.styleFile: /dev/null"
          ].join("\n") + "\n");
          fs.writeFileSync(path.join(fbDir, "apps"), [
            "[app] (name=.*) (class=.*)",
            "  [Maximized] {yes}",
            "  [Deco] {NONE}",
            "  [Dimensions] {1280 720}",
            "  [Position] {0 0}",
            "[end]"
          ].join("\n") + "\n");
          const fbProc = spawnProc(fluxbox, [], {
            detached: false,
            stdio: "ignore",
            env: { ...process.env, DISPLAY: VNC_DISPLAY }
          });
          _vncProcs.push(fbProc);
          await new Promise((r) => setTimeout(r, 1e3));
          console.log("[VNC] Fluxbox window manager started (kiosk mode)");
        } catch {
        }
      }
      try {
        const globSync = __require("node:fs").readdirSync;
        const pwCacheBase = path.join(process.cwd(), ".cache", "ms-playwright");
        let chromiumExe = "";
        try {
          const dirs = fs.readdirSync(pwCacheBase).filter((d) => d.startsWith("chromium-")).sort().reverse();
          for (const d of dirs) {
            const candidate = path.join(pwCacheBase, d, "chrome-linux64", "chrome");
            if (fs.existsSync(candidate)) {
              chromiumExe = candidate;
              break;
            }
            const candidate2 = path.join(pwCacheBase, d, "chrome-linux", "chrome");
            if (fs.existsSync(candidate2)) {
              chromiumExe = candidate2;
              break;
            }
          }
        } catch {
        }
        if (!chromiumExe) {
          try {
            chromiumExe = execSync("which chromium 2>/dev/null || which google-chrome 2>/dev/null || which chromium-browser 2>/dev/null", { encoding: "utf-8", timeout: 2e3 }).trim();
          } catch {
          }
        }
        if (chromiumExe) {
          try {
            execSync("pkill -f 'chromium.*--remote-debugging-port' 2>/dev/null; true", { timeout: 3e3 });
          } catch {
          }
          await new Promise((r) => setTimeout(r, 500));
          _chromiumProc = spawnProc(chromiumExe, [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--disable-extensions",
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--window-size=1280,720",
            "--window-position=0,0",
            "--start-maximized",
            `--remote-debugging-port=${CDP_PORT}`,
            "--remote-debugging-address=127.0.0.1",
            `--user-data-dir=/tmp/dzeck-chrome-data-${Date.now()}`,
            "about:blank"
          ], {
            detached: true,
            stdio: "ignore",
            env: { ...process.env, DISPLAY: VNC_DISPLAY }
          });
          _chromiumProc.unref();
          await new Promise((r) => setTimeout(r, 2e3));
          process.env.DZECK_CDP_URL = `http://127.0.0.1:${CDP_PORT}`;
          console.log(`[VNC] Persistent Chromium launched (CDP port ${CDP_PORT}, exe: ${chromiumExe})`);
        } else {
          console.warn("[VNC] No Chromium binary found \u2014 browser will launch per-agent-session");
        }
      } catch (chrErr) {
        console.warn("[VNC] Failed to launch persistent Chromium:", chrErr?.message);
      }
      _vncStarted = true;
      _vncStarting = false;
      vncTouch();
      console.log(`[VNC] Stack ready: DISPLAY=${VNC_DISPLAY} VNC_PORT=${VNC_PORT_NUM} (idle timeout: 10min)`);
      return true;
    } catch (err) {
      console.error("[VNC] Failed to start:", err.message);
      _vncStarting = false;
      return false;
    }
  }
  app2.post("/api/vnc/start", async (_req, res) => {
    const started = await ensureVncRunning();
    res.json({ started });
  });
  app2.get("/vnc-view", (_req, res) => {
    const html = path.join(__dirname, "templates", "vnc-view.html");
    if (fs.existsSync(html)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(html);
    } else {
      res.status(404).send("vnc-view.html not found");
    }
  });
  app2.get("/api/vnc/status", (_req, res) => {
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
  const httpServer = createServer(app2);
  setImmediate(() => {
    ensureVncRunning().then((ok) => {
      if (ok) {
        console.log("[VNC] Auto-started VNC stack at server boot \u2014 browser will use display :10");
      } else {
        console.warn("[VNC] Auto-start failed \u2014 VNC display may be unavailable");
      }
    }).catch((e) => {
      console.warn("[VNC] Auto-start error:", e?.message);
    });
  });
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (clientWs, _req) => {
    vncTouch();
    console.log(`[VNC-WS] Client connected \u2192 proxying to VNC TCP:${VNC_PORT_NUM}`);
    const vncSocket = net.createConnection({ port: VNC_PORT_NUM, host: "127.0.0.1" });
    vncSocket.on("connect", () => {
      console.log(`[VNC-WS] TCP connected to x11vnc:${VNC_PORT_NUM} \u2713`);
    });
    clientWs.on("message", (data, isBinary) => {
      if (vncSocket.writable) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        vncSocket.write(buf);
      }
    });
    vncSocket.on("data", (data) => {
      if (clientWs.readyState === 1) {
        clientWs.send(data, { binary: true });
      }
    });
    const cleanup = () => {
      try {
        if (clientWs.readyState !== 3) clientWs.close();
      } catch {
      }
      try {
        vncSocket.destroy();
      } catch {
      }
    };
    vncSocket.on("error", (err) => {
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
  handleVncUpgrade = (req, socket, head) => {
    const url = req.url || "";
    if (url.startsWith("/vnc-ws")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  };
  httpServer.on("upgrade", handleVncUpgrade);
  return httpServer;
}

// server/index.ts
import * as fs2 from "fs";
import * as path2 from "path";
var qrcode = __require("qrcode-terminal");
(function loadDotEnv() {
  const envPath = path2.resolve(process.cwd(), ".env");
  if (!fs2.existsSync(envPath)) return;
  const lines = fs2.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
})();
var app = express();
var log = console.log;
function setupCors(app2) {
  app2.use((req, res, next) => {
    const origins = /* @__PURE__ */ new Set();
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }
    if (process.env.CORS_ORIGINS) {
      process.env.CORS_ORIGINS.split(",").forEach((o) => {
        origins.add(o.trim());
      });
    }
    if (process.env.APP_DOMAIN) {
      origins.add(`https://${process.env.APP_DOMAIN}`);
    }
    const origin = req.header("origin");
    const isLocalhost = origin?.startsWith("http://localhost:") || origin?.startsWith("http://127.0.0.1:");
    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS"
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
}
function setupBodyParsing(app2) {
  app2.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      }
    })
  );
  app2.use(express.urlencoded({ extended: false }));
}
function setupRequestLogging(app2) {
  app2.use((req, res, next) => {
    const start = Date.now();
    const path3 = req.path;
    let capturedJsonResponse = void 0;
    const originalResJson = res.json;
    res.json = function(bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };
    res.on("finish", () => {
      if (!path3.startsWith("/api")) return;
      const duration = Date.now() - start;
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    });
    next();
  });
}
function getAppName() {
  try {
    const appJsonPath = path2.resolve(process.cwd(), "app.json");
    const appJsonContent = fs2.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}
function serveExpoManifest(platform, res) {
  const manifestPath = path2.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json"
  );
  if (!fs2.existsSync(manifestPath)) {
    return res.status(404).json({ error: `Manifest not found for platform: ${platform}` });
  }
  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");
  const manifest = fs2.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}
function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;
  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);
  const html = landingPageTemplate.replace(/BASE_URL_PLACEHOLDER/g, baseUrl).replace(/EXPS_URL_PLACEHOLDER/g, expsUrl).replace(/APP_NAME_PLACEHOLDER/g, appName);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
function configureExpoAndLanding(app2) {
  const landingTemplatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html"
  );
  const webChatTemplatePath = path2.resolve(
    process.cwd(),
    "server",
    "templates",
    "web-chat.html"
  );
  const landingPageTemplate = fs2.readFileSync(landingTemplatePath, "utf-8");
  const webChatTemplate = fs2.readFileSync(webChatTemplatePath, "utf-8");
  const appName = getAppName();
  log("Serving static Expo files with dynamic manifest routing");
  app2.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    if (req.path === "/mobile") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName
      });
    }
    if (req.path === "/manifest") {
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      return next();
    }
    if (req.path === "/") {
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(webChatTemplate);
    }
    next();
  });
  app2.use("/assets", express.static(path2.resolve(process.cwd(), "assets")));
  app2.use("/novnc", express.static(path2.resolve(process.cwd(), "node_modules/@novnc/novnc/lib")));
  app2.use(express.static(path2.resolve(process.cwd(), "static-build")));
  log("Expo routing: Checking expo-platform header on / and /manifest");
}
function setupErrorHandler(app2) {
  app2.use((err, _req, res, next) => {
    const error = err;
    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
}
function printExpoQR(port) {
  try {
    const replitDomain = process.env.REPLIT_DEV_DOMAIN || "";
    const replitDomains = process.env.REPLIT_DOMAINS || "";
    let host = "";
    if (replitDomain) {
      host = replitDomain;
    } else if (replitDomains) {
      host = replitDomains.split(",")[0].trim();
    }
    if (!host) return;
    const expoUrl = `exp://${host}`;
    const webUrl = `https://${host}`;
    log("");
    log("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557");
    log("\u2551       Dzeck AI - Expo Go QR Code       \u2551");
    log("\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D");
    log("");
    log(`  Scan QR di bawah dengan aplikasi Expo Go`);
    log(`  atau buka: ${webUrl}`);
    log("");
    qrcode.generate(expoUrl, { small: true }, (qr) => {
      log(qr);
      log(`  URL Expo Go: ${expoUrl}`);
      log(`  URL Browser: ${webUrl}`);
      log("");
    });
  } catch (e) {
  }
}
(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);
  configureExpoAndLanding(app);
  const server = await registerRoutes(app);
  setupErrorHandler(app);
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true
    },
    () => {
      log(`express server serving on port ${port}`);
      printExpoQR(port);
    }
  );
  const { createServer: createHttpServer } = await import("node:http");
  const extraPorts = [8081, 8082];
  for (const webPort of extraPorts) {
    const extraServer = createHttpServer(app);
    extraServer.on("upgrade", (req, socket, head) => {
      const fn = handleVncUpgrade;
      if (fn) fn(req, socket, head);
      else socket.destroy();
    });
    extraServer.listen(
      {
        port: webPort,
        host: "0.0.0.0",
        reusePort: true
      },
      () => {
        log(`express server also serving on port ${webPort}`);
      }
    ).on("error", (err) => {
      if (err.code !== "EADDRINUSE") {
        console.error(`Port ${webPort} error:`, err);
      }
    });
  }
})();
