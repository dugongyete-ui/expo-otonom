import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { registerE2BDesktopRoutes } from "./e2b-desktop";
import { registerAuthRoutes } from "./auth-routes";
import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { execFile as _execFile } from "node:child_process";
import { randomBytes } from "node:crypto";

(function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const domainKeys = new Set(["APP_DOMAIN", "EXPO_PUBLIC_DOMAIN", "CORS_ORIGINS"]);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && (!(key in process.env) || domainKeys.has(key))) {
      process.env[key] = val;
    }
  }
})();

// Always force domain-related env vars to use REPLIT_DEV_DOMAIN when available,
// overriding any potentially stale hardcoded values from userenv or .env.
if (process.env.REPLIT_DEV_DOMAIN) {
  process.env.APP_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
  process.env.EXPO_PUBLIC_DOMAIN = process.env.REPLIT_DEV_DOMAIN;
  process.env.CORS_ORIGINS = `https://${process.env.REPLIT_DEV_DOMAIN}`;
}

// Diagnostic: confirm critical env vars loaded from .env
if (process.env.E2B_API_KEY) {
  const key = process.env.E2B_API_KEY;
  console.log("[env] E2B_API_KEY loaded (%d chars, prefix: %s...)", key.length, key.substring(0, 4));
  if (!key.startsWith("e2b_")) {
    console.warn("[env] WARNING: E2B_API_KEY does not start with 'e2b_' — it may be invalid");
  }
} else {
  console.warn("[env] E2B_API_KEY not found in environment or .env — E2B sandbox features will be unavailable");
  console.warn("[env] To enable E2B sandbox, set E2B_API_KEY in .env or environment variables");
}

// Startup validation: warn about missing or misconfigured env vars
(function validateEnv() {
  const warnings: string[] = [];

  if (!process.env.CEREBRAS_API_KEY) {
    warnings.push("CEREBRAS_API_KEY — required for AI chat and agent. Get from https://cloud.cerebras.ai/");
  }
  if (!process.env.MONGODB_URI) {
    warnings.push("MONGODB_URI — required for session persistence. Agent will run without history.");
  }
  if (!process.env.MONGO_DB_NAME) {
    warnings.push("MONGO_DB_NAME — database name not set, defaulting to 'manus'. Add MONGO_DB_NAME=manus to .env");
    process.env.MONGO_DB_NAME = "manus";
  }
  if (!process.env.AUTH_PROVIDER) {
    warnings.push("AUTH_PROVIDER — not set, defaulting to 'none' (auto-login). Add AUTH_PROVIDER=none to .env");
    process.env.AUTH_PROVIDER = "none";
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    // Auto-generate JWT secret if missing (session-scoped — restarts will invalidate tokens)
    process.env.JWT_SECRET = randomBytes(32).toString("hex");
    warnings.push("JWT_SECRET — not set or too short. Generated a random secret for this session. Set JWT_SECRET in .env for persistence across restarts.");
  }
  if (!process.env.SEARCH_PROVIDER) {
    warnings.push("SEARCH_PROVIDER — not set, defaulting to 'bing_web'. Add SEARCH_PROVIDER=bing_web to .env");
    process.env.SEARCH_PROVIDER = "bing_web";
  }
  if (!process.env.LOG_LEVEL) {
    process.env.LOG_LEVEL = "INFO";
  }
  if (!process.env.CORS_ORIGINS && !process.env.APP_DOMAIN) {
    warnings.push("CORS_ORIGINS / APP_DOMAIN — not set. CORS will only allow localhost and Expo Go. Set CORS_ORIGINS or APP_DOMAIN for production.");
  }
  if (!process.env.EMAIL_HOST) {
    warnings.push("EMAIL_HOST — not set. Email tool will return a clear error when used. Set EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD, EMAIL_PORT to enable.");
  }

  if (warnings.length > 0) {
    console.warn("[env] Startup configuration warnings (%d):", warnings.length);
    for (const w of warnings) {
      console.warn(`[env]   ⚠  ${w}`);
    }
  } else {
    console.log("[env] All required env vars are set.");
  }
})();

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    if (process.env.CORS_ORIGINS) {
      process.env.CORS_ORIGINS.split(",").forEach((o: string) => {
        origins.add(o.trim());
      });
    }

    if (process.env.APP_DOMAIN) {
      origins.add(`https://${process.env.APP_DOMAIN}`);
      origins.add(`http://${process.env.APP_DOMAIN}`);
    }

    const origin = req.header("origin");
    const isDev = process.env.NODE_ENV !== "production";

    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    // Allow Expo Go (exp:// scheme) and React Native Metro bundler origins
    const isExpoGo =
      origin?.startsWith("exp://") ||
      origin?.startsWith("exps://");

    // Allow all Replit tunnel/preview origins in dev mode
    const isReplitTunnel =
      isDev &&
      (origin?.endsWith(".replit.dev") ||
        origin?.endsWith(".repl.co") ||
        origin?.endsWith(".picard.replit.dev"));

    const isAllowed =
      !origin ||
      origins.has(origin) ||
      isLocalhost ||
      isExpoGo ||
      isReplitTunnel;

    if (isAllowed && origin) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "App Landing Page";
  }
}

const METRO_PORT = 3002;

/**
 * Proxy a request to Metro bundler and stream the response back.
 * Used for bundle and asset downloads so they go through Express (port 80/HTTPS)
 * rather than directly to Metro's port (which Replit's proxy can't handle for large bundles).
 */
const METRO_PROXY_MAX_RETRIES = 2;
const METRO_PROXY_RETRY_DELAY_MS = 1500;

/**
 * Proxy a request to Metro bundler and stream the response back.
 * Retries up to METRO_PROXY_MAX_RETRIES times on timeout or transient connection
 * errors (ECONNRESET, ECONNREFUSED) before returning an error to the client.
 * Only retries are performed before response headers are sent.
 */
function proxyToMetro(req: Request, res: Response) {
  const metroPath = req.url.replace(/^\/metro-proxy/, "");
  // Bundle requests can take a long time to compile — use a generous timeout.
  const isBundle = metroPath.endsWith(".bundle") || req.path.endsWith(".bundle");
  const socketTimeout = isBundle ? 120_000 : 30_000;

  const options: http.RequestOptions = {
    hostname: "localhost",
    port: METRO_PORT,
    path: metroPath || "/",
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${METRO_PORT}`,
    },
  };

  // Buffer the request body so we can replay it on retries (req stream can only be read once).
  const bodyChunks: Buffer[] = [];
  const bodyReady = new Promise<Buffer>((resolve, reject) => {
    req.on("data", (chunk: Buffer) => bodyChunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(bodyChunks)));
    req.on("error", reject);
  });

  function attempt(attemptsLeft: number): void {
    // Guard: ensure only one of (timeout, error) triggers a retry/response for this attempt.
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      return true;
    };

    const proxyReq = http.request(options, (proxyRes) => {
      if (res.headersSent) return;
      res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers as Record<string, string>);
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.setTimeout(socketTimeout, () => {
      if (!settle()) return;
      log(`[Expo] Metro proxy timeout after ${socketTimeout}ms for ${metroPath} (attempts left: ${attemptsLeft})`);
      proxyReq.destroy();
      if (res.headersSent) return;
      if (attemptsLeft > 0) {
        setTimeout(() => attempt(attemptsLeft - 1), METRO_PROXY_RETRY_DELAY_MS);
      } else {
        res.status(504).json({ error: "Metro bundler timed out after retries. Bundle is still compiling — please retry." });
      }
    });

    const isTransient = (code?: string) =>
      code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT";

    proxyReq.on("error", (err: NodeJS.ErrnoException) => {
      if (!settle()) return;
      log(`[Expo] Metro proxy error: ${err.message} (attempts left: ${attemptsLeft})`);
      if (res.headersSent) return;
      if (attemptsLeft > 0 && isTransient(err.code)) {
        setTimeout(() => attempt(attemptsLeft - 1), METRO_PROXY_RETRY_DELAY_MS);
      } else {
        res.status(502).json({ error: `Metro bundler proxy error: ${err.message}` });
      }
    });

    // Write buffered body (or nothing for GET requests) and close the request.
    bodyReady.then((body) => {
      if (body.length > 0) proxyReq.write(body);
      proxyReq.end();
    }).catch((err) => {
      log(`[Expo] Metro proxy body read error: ${err.message}`);
      proxyReq.destroy();
      if (!res.headersSent) res.status(500).json({ error: "Failed to read request body for Metro proxy" });
    });
  }

  attempt(METRO_PROXY_MAX_RETRIES);
}

/**
 * Poll Metro's /__metro/ping endpoint until it responds 200 or the deadline passes.
 * Returns true if Metro is ready, false if timed out.
 */
async function waitForMetroReady(metroPort: number, waitMs: number = 60_000): Promise<boolean> {
  const deadline = Date.now() + waitMs;
  const pollInterval = 1500;

  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 2000);
      const pingRes = await fetch(`http://localhost:${metroPort}/__metro/ping`, {
        signal: ctrl.signal,
      }).finally(() => clearTimeout(t));
      if (pingRes.ok) {
        return true;
      }
    } catch {
      // Metro not up yet — keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  return false;
}

async function proxyManifestFromMetro(
  platform: string,
  req: Request,
  res: Response,
  metroPort: number = METRO_PORT,
) {
  try {
    // Wait for Metro to be ready before trying to fetch the manifest.
    // This prevents Expo Go from seeing "Packager is not running" while Metro is still
    // compiling the bundle for the first time.
    const isReady = await waitForMetroReady(metroPort, 60_000);
    if (!isReady) {
      log("[Expo] Metro did not become ready within 60s — aborting manifest request");
      return res.status(503).json({
        error: "Metro bundler is still starting. Please wait a moment and try again.",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    // Try root '/' first (what Expo Go actually requests), fallback to '/manifest'
    let metroRes = await fetch(`http://localhost:${metroPort}/`, {
      headers: {
        "expo-platform": platform,
        "accept": "application/expo+json,application/json",
        "expo-protocol-version": "1",
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    // Fallback to /manifest if root returns non-JSON
    if (!metroRes.ok || !metroRes.headers.get("content-type")?.includes("json")) {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 30000);
      metroRes = await fetch(`http://localhost:${metroPort}/manifest`, {
        headers: {
          "expo-platform": platform,
          "accept": "application/expo+json,application/json",
        },
        signal: controller2.signal,
      }).finally(() => clearTimeout(timeout2));
    }

    if (!metroRes.ok) {
      return res.status(502).json({
        error: `Metro bundler returned ${metroRes.status}. Is Expo Go workflow running?`,
      });
    }

    const manifest = await metroRes.json() as Record<string, unknown>;

    // Determine the public HTTPS base URL for this server (Express backend on port 80)
    // Priority: REPLIT_DEV_DOMAIN (always current) > APP_DOMAIN > EXPO_PUBLIC_DOMAIN > x-forwarded-host > req.host
    //
    // IMPORTANT: x-forwarded-host is NOT reliable for Expo Go connections — Replit routes
    // Expo Go requests through a different proxy path and may send a different host header.
    // REPLIT_DEV_DOMAIN is automatically set by Replit to the current active domain and is the
    // most reliable source. APP_DOMAIN is set by update-domain.sh but may be stale if hardcoded.
    const forwardedProto = "https";
    const forwardedHost =
      process.env.REPLIT_DEV_DOMAIN ||
      process.env.APP_DOMAIN ||
      process.env.EXPO_PUBLIC_DOMAIN ||
      req.header("x-forwarded-host") ||
      req.get("host") ||
      "";
    const backendBase = `${forwardedProto}://${forwardedHost}`;

    // Rewrite Metro's bundle URLs to go through Express backend so that Expo Go
    // downloads bundles via HTTPS on port 80 (no Replit proxy issues).
    //
    // Two patterns to cover:
    //  1. URLs with an explicit port: http://host:3002/...  (original Metro internal URLs)
    //  2. URLs without an explicit port: https://domain.replit.dev/...
    //     These appear when app.config.js sets `origin` to the public HTTPS domain,
    //     causing Metro to embed portless HTTPS URLs directly in the manifest.
    let manifestStr = JSON.stringify(manifest);

    // Pattern 1: http(s)://host:port/ — replace entire origin+port
    manifestStr = manifestStr.replace(
      /https?:\/\/[^"/:]+:\d+\//g,
      `${backendBase}/metro-proxy/`,
    );

    // Pattern 2: https://public-domain/ (no port) — only rewrite if it matches the
    // known public domain, to avoid accidentally rewriting unrelated HTTPS URLs.
    if (forwardedHost) {
      const escapedHost = forwardedHost.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      manifestStr = manifestStr.replace(
        new RegExp(`https?://${escapedHost}/`, "g"),
        `${backendBase}/metro-proxy/`,
      );
    }

    // Also rewrite hostUri and debuggerHost (format: "host:port") so that
    // hot-reload WebSocket connections also go through the Express proxy domain
    const metroHostPort = `[^"]+:${metroPort}`;
    manifestStr = manifestStr.replace(
      new RegExp(`"(${metroHostPort})"`, "g"),
      `"${forwardedHost}"`,
    );

    res.setHeader("expo-protocol-version", "1");
    res.setHeader("expo-sfv-version", "0");
    res.setHeader("content-type", "application/json");
    res.send(manifestStr);

    log(`[Expo] Proxied ${platform} manifest (backendBase: ${backendBase}) → bundle via Express`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[Expo] Metro proxy failed: ${msg}`);
    return res.status(502).json({
      error: "Metro bundler unavailable. Make sure the Expo Go workflow is running.",
    });
  }
}

async function serveExpoManifest(platform: string, req: Request, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    // Fallback: proxy manifest from the running Metro dev server (port 3002)
    // Rewrite bundle URLs to go through Express backend so Expo Go downloads
    // via HTTPS on port 80 (avoids Replit proxy issues on port 3002)
    log(`[Expo] static-build not found — falling back to Metro dev proxy`);
    return proxyManifestFromMetro(platform, req, res, METRO_PORT);
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  const manifest = fs.readFileSync(manifestPath, "utf-8");
  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const landingTemplatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "landing-page.html",
  );
  const webChatTemplatePath = path.resolve(
    process.cwd(),
    "server",
    "templates",
    "web-chat.html",
  );
  const landingPageTemplate = fs.readFileSync(landingTemplatePath, "utf-8");
  const webChatTemplate = fs.readFileSync(webChatTemplatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    if (req.path === "/mobile") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    if (req.path === "/e2b-viewer") {
      const e2bViewerPath = path.resolve(process.cwd(), "server", "templates", "e2b-vnc-view.html");
      if (fs.existsSync(e2bViewerPath)) {
        const e2bTemplate = fs.readFileSync(e2bViewerPath, "utf-8");
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        return res.status(200).send(e2bTemplate);
      }
      return res.status(404).send("E2B viewer not found");
    }

    if (req.path === "/manifest") {
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return await serveExpoManifest(platform, req, res);
      }
      return next();
    }

    if (req.path === "/") {
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return await serveExpoManifest(platform, req, res);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(webChatTemplate);
    }

    // Metro proxy: forward /metro-proxy/* requests to Metro bundler on localhost:METRO_PORT
    // This allows Expo Go to download bundles via Express HTTPS (port 80) instead of
    // Metro's port directly (which Replit's proxy can't handle for large 10MB+ bundles)
    if (req.path.startsWith("/metro-proxy/") || req.path === "/metro-proxy") {
      return proxyToMetro(req, res);
    }

    // Catch-all Metro proxy: forward bundle/asset/Metro-specific paths to Metro bundler.
    // Expo Go requests bundle URLs like /index.bundle?platform=android which Express has
    // no static handler for. Forward these directly to Metro on port 3002.
    //
    // NOTE: This project uses the catch-all approach rather than rewriting bundle URLs
    // in app.config.js. Because app.config.js sets `origin` to the HTTPS Replit domain,
    // Metro injects that domain directly into manifest bundle URLs (bypassing the
    // http://localhost rewrite regex in proxyManifestFromMetro). The catch-all here
    // intercepts those direct-to-Express HTTPS requests and forwards them to Metro.
    // If new Metro endpoints appear (symbolication, /reload, etc.), add them below.
    const isMetroPath =
      req.path.endsWith(".bundle") ||
      req.path.endsWith(".map") ||
      req.path.startsWith("/__metro") ||
      req.path.startsWith("/__debugger") ||
      req.path.startsWith("/debugger-ui") ||
      req.path.startsWith("/hot") ||
      req.path === "/reload" ||
      req.path === "/symbolicate" ||
      (req.path.startsWith("/assets/") && req.query["platform"] !== undefined) ||
      req.query["bundleType"] !== undefined;

    if (isMetroPath) {
      log(`[Expo] Catch-all Metro proxy: ${req.method} ${req.path}`);
      // Reuse proxyToMetro but the path is already correct (no /metro-proxy prefix to strip)
      // We temporarily rewrite req.url so proxyToMetro strips nothing meaningful
      const savedUrl = req.url;
      req.url = `/metro-proxy${req.url}`;
      // proxyToMetro strips /metro-proxy prefix, leaving the original path intact
      proxyToMetro(req, res);
      req.url = savedUrl;
      return;
    }

    next();
  });

  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use("/novnc", express.static(path.resolve(process.cwd(), "node_modules/@novnc/novnc/lib")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}


(async () => {
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  // Register E2B Desktop Sandbox routes (VNC streaming, session management)
  registerE2BDesktopRoutes(app, server);

  // Register JWT authentication routes
  registerAuthRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
      log(`[Dzeck AI] Server ready — E2B cloud sandbox mode`);

      // Bootstrap MongoDB schema indexes at startup (best-effort, non-blocking)
      if (process.env.MONGODB_URI) {
        setTimeout(() => {
          _execFile(
            "python3",
            ["-c", `
import asyncio, sys
sys.path.insert(0, '${process.cwd().replace(/\\/g, "/")}')
async def main():
    try:
        from server.agent.db.schema import initialize_schema
        ok = await initialize_schema()
        print('[Schema]', 'initialized' if ok else 'skipped')
    except Exception as e:
        print('[Schema] warning:', e, file=sys.stderr)
asyncio.run(main())
`],
            { env: process.env, cwd: process.cwd(), timeout: 30000 },
            (_err: any, stdout: string, stderr: string) => {
              if (stdout.trim()) log(stdout.trim());
              if (stderr.trim()) console.warn("[Schema]", stderr.trim());
            },
          );
        }, 2000);
      }

      // Run tool health check at startup and log results
      setTimeout(async () => {
        try {
          const toolsRes = await fetch(`http://127.0.0.1:${port}/api/health/tools`);
          if (toolsRes.ok) {
            const health = await toolsRes.json() as Record<string, any>;
            const e2b = health.e2b_enabled ? "✓ connected" : "✗ not configured";
            const cerebras = health.cerebras_configured ? "✓ configured" : "✗ missing key";
            log(`[Health] E2B sandbox: ${e2b} | Cerebras AI: ${cerebras}`);
            if (health.tools) {
              const toolStatuses = Object.entries(health.tools as Record<string, any>)
                .map(([name, info]: [string, any]) => `${name}=${info.status}`)
                .join(", ");
              log(`[Health] Tools: ${toolStatuses}`);
            }
          }
        } catch {
          // Health check at startup is best-effort
        }
      }, 3000);
    },
  );

})();
