import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes, handleVncUpgrade } from "./routes";
import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const qrcode = _require("qrcode-terminal") as { generate: (text: string, opts: object, cb: (qr: string) => void) => void };

// Load .env file if it exists (supports local dev and APK builds)
(function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
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

    // Support Replit domains
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d: string) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    // Support custom allowed origins via CORS_ORIGINS env var (comma-separated)
    if (process.env.CORS_ORIGINS) {
      process.env.CORS_ORIGINS.split(",").forEach((o: string) => {
        origins.add(o.trim());
      });
    }

    // Support the app's own domain
    if (process.env.APP_DOMAIN) {
      origins.add(`https://${process.env.APP_DOMAIN}`);
    }

    const origin = req.header("origin");

    // Allow localhost origins for Expo web development (any port)
    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    if (origin && (origins.has(origin) || isLocalhost)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
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

function serveExpoManifest(platform: string, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
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

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) {
      return next();
    }

    // Serve mobile landing page at /mobile
    if (req.path === "/mobile") {
      return serveLandingPage({
        req,
        res,
        landingPageTemplate,
        appName,
      });
    }

    // Serve Expo manifest for native clients
    if (req.path === "/manifest") {
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, res);
      }
      return next();
    }

    // Serve web chat UI at root for browser clients
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

function printExpoQR(port: number): void {
  try {
    // Resolve the public host for Expo Go
    const replitDomain = process.env.REPLIT_DEV_DOMAIN || "";
    const replitDomains = process.env.REPLIT_DOMAINS || "";

    let host = "";
    if (replitDomain) {
      host = replitDomain;
    } else if (replitDomains) {
      host = replitDomains.split(",")[0].trim();
    }

    if (!host) return; // Can't generate QR without a public domain

    // Expo Go URL: exp:// uses port 80 when accessed via Replit proxy
    const expoUrl = `exp://${host}`;
    const webUrl = `https://${host}`;

    log("");
    log("╔════════════════════════════════════════╗");
    log("║       Dzeck AI - Expo Go QR Code       ║");
    log("╚════════════════════════════════════════╝");
    log("");
    log(`  Scan QR di bawah dengan aplikasi Expo Go`);
    log(`  atau buka: ${webUrl}`);
    log("");

    qrcode.generate(expoUrl, { small: true }, (qr: string) => {
      log(qr);
      log(`  URL Expo Go: ${expoUrl}`);
      log(`  URL Browser: ${webUrl}`);
      log("");
    });
  } catch (e) {
    // QR code generation is optional — don't crash server
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
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
      printExpoQR(port);
    },
  );

  // Also serve web chat on additional ports so users land on web chat
  // regardless of which port they access
  const { createServer: createHttpServer } = await import("node:http");
  const extraPorts = [8081, 8082]; // 8081=external:80, 8082=external:3000
  for (const webPort of extraPorts) {
    const extraServer = createHttpServer(app);
    // Attach VNC WebSocket upgrade handler to extra port servers
    extraServer.on("upgrade", (req: any, socket: any, head: any) => {
      const fn = handleVncUpgrade;
      if (fn) fn(req, socket, head);
      else socket.destroy();
    });
    extraServer.listen(
      {
        port: webPort,
        host: "0.0.0.0",
        reusePort: true,
      },
      () => {
        log(`express server also serving on port ${webPort}`);
      },
    ).on("error", (err: NodeJS.ErrnoException) => {
      if (err.code !== "EADDRINUSE") {
        console.error(`Port ${webPort} error:`, err);
      }
    });
  }
})();
