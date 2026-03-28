import express from "express";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { registerE2BDesktopRoutes } from "./e2b-desktop";
import { registerAuthRoutes } from "./auth-routes";
import * as fs from "fs";
import * as path from "path";

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
