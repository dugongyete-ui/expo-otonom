/**
 * JWT Authentication Routes for Dzeck AI
 * Supports three modes: password (MongoDB-backed), local (env vars), none (auto-login)
 *
 * Security:
 * - JWT_SECRET must be set in env for non-none modes; fails fast if missing
 * - Passwords hashed with bcrypt (12 rounds) with per-user salt
 * - Tokens revoked on logout (stored in Redis with TTL; survives restarts)
 * - "password" mode stores users in MongoDB `users` collection via MongoUserRepository
 */
import { randomUUID } from "node:crypto";
import * as crypto from "node:crypto";
import * as bcrypt from "bcryptjs";
import { getCollection } from "./db/mongo";
import { redisSet, redisGet } from "./db/redis";

async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  const host = process.env.EMAIL_HOST;
  if (!host) {
    console.warn(`[auth/reset] EMAIL_HOST not configured — password reset email not sent to ${to}`);
    return;
  }
  try {
    const nodemailer = await import("nodemailer");
    const port = parseInt(process.env.EMAIL_PORT || "587", 10);
    const secure = (process.env.EMAIL_USE_TLS || "").toLowerCase() === "ssl";
    const user = process.env.EMAIL_USER || process.env.EMAIL_USERNAME || "";
    const pass = process.env.EMAIL_PASSWORD || "";
    const from = process.env.EMAIL_FROM || user || `noreply@${host}`;

    const transporter = nodemailer.default.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
    });

    await transporter.sendMail({
      from,
      to,
      subject: "Reset your password",
      text: `To reset your password, click this link: ${resetUrl}\n\nThis link expires in 15 minutes.`,
      html: `<p>To reset your password, click <a href="${resetUrl}">here</a>.</p><p>This link expires in 15 minutes.</p>`,
    });
    console.log(`[auth/reset] Password reset email sent to ${to}`);
  } catch (err: any) {
    console.warn(`[auth/reset] Failed to send password reset email to ${to}: ${err.message}`);
  }
}

interface User {
  id: string;
  email: string;
  fullname: string;
  role: "user" | "admin";
  active: boolean;
  createdAt: number;
}

interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  type: "access" | "refresh" | "password_reset";
  exp: number;
}

function getAuthMode(): "password" | "local" | "none" {
  return (process.env.AUTH_PROVIDER as any) || "none";
}

function getJwtSecret(): string {
  const mode = getAuthMode();
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (mode === "none") {
      return "dzeck-auto-login-insecure-key-not-for-production";
    }
    throw new Error("JWT_SECRET environment variable must be set when AUTH_PROVIDER is not 'none'");
  }
  if (secret.length < 32 && mode !== "none") {
    console.warn("[auth] WARNING: JWT_SECRET is short (< 32 chars) — use a longer secret");
  }
  return secret;
}

const ACCESS_TOKEN_EXPIRE_MINUTES = 60;
const REFRESH_TOKEN_EXPIRE_DAYS = 30;
const BCRYPT_ROUNDS = 12;

async function isTokenRevoked(token: string): Promise<boolean> {
  try {
    const val = await redisGet(`revoked_token:${token}`);
    return val === "1";
  } catch {
    return false;
  }
}

async function revokeToken(token: string, ttlSeconds?: number): Promise<boolean> {
  try {
    const ok = await redisSet(`revoked_token:${token}`, "1", ttlSeconds || 86400 * 31);
    if (!ok) {
      console.warn("[auth] WARNING: Redis unavailable — token revocation could not be persisted. Token may remain valid until expiry.");
    }
    return ok;
  } catch (err: any) {
    console.warn("[auth] WARNING: Token revocation failed (Redis error):", err.message, "— Token may remain valid until expiry.");
    return false;
  }
}

function hmacSha256(data: string, key: string): string {
  return crypto.createHmac("sha256", key).update(data).digest("base64url");
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

function createJwt(payload: Omit<TokenPayload, "exp">, expiresInSeconds: number): string {
  const secret = getJwtSecret();
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = base64url(JSON.stringify({ ...payload, exp }));
  const sig = hmacSha256(`${header}.${body}`, secret);
  return `${header}.${body}.${sig}`;
}

function verifyJwtSync(token: string): TokenPayload | null {
  try {
    const secret = getJwtSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = hmacSha256(`${header}.${body}`, secret);
    if (sig !== expectedSig) return null;
    const payload: TokenPayload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyJwtAsync(token: string): Promise<TokenPayload | null> {
  const payload = verifyJwtSync(token);
  if (!payload) return null;
  const revoked = await isTokenRevoked(token);
  if (revoked) return null;
  return payload;
}

function verifyJwt(token: string): TokenPayload | null {
  return verifyJwtSync(token);
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ─── MongoDB user helpers (password mode) ────────────────────────────────────

async function mongoFindUserByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
  const col = await getCollection("users");
  if (!col) throw new Error("MongoDB unavailable — cannot authenticate user");
  const doc = await (col as any).findOne({ email }, { projection: { _id: 0 } });
  return doc || null;
}

async function mongoFindUserById(id: string): Promise<(User & { passwordHash: string }) | null> {
  const col = await getCollection("users");
  if (!col) throw new Error("MongoDB unavailable — cannot look up user");
  const doc = await (col as any).findOne({ id }, { projection: { _id: 0 } });
  return doc || null;
}

async function mongoCreateUser(user: User & { passwordHash: string }): Promise<void> {
  const col = await getCollection("users");
  if (!col) throw new Error("MongoDB unavailable — cannot create user");
  await (col as any).insertOne({ ...user });
}

// ─── Token → User resolution ─────────────────────────────────────────────────

async function getUserFromTokenAsync(token: string): Promise<User | null> {
  const payload = await verifyJwtAsync(token);
  if (!payload || payload.type !== "access") return null;

  const mode = getAuthMode();
  if (mode === "none") {
    return {
      id: "auto-user",
      email: process.env.LOCAL_USER_EMAIL || "user@dzeck.ai",
      fullname: process.env.LOCAL_USER_NAME || "Dzeck User",
      role: "admin",
      active: true,
      createdAt: 0,
    };
  }
  if (mode === "local") {
    const email = process.env.LOCAL_USER_EMAIL || "";
    if (payload.email === email) {
      return {
        id: "local-user",
        email,
        fullname: process.env.LOCAL_USER_NAME || "Local User",
        role: "admin",
        active: true,
        createdAt: 0,
      };
    }
    return null;
  }
  // password mode — look up in MongoDB
  try {
    const user = await mongoFindUserById(payload.userId);
    if (!user || !user.active) return null;
    return { id: user.id, email: user.email, fullname: user.fullname, role: user.role, active: user.active, createdAt: user.createdAt };
  } catch (err: any) {
    console.error("[auth] MongoDB user lookup failed:", err.message);
    return null;
  }
}

function getUserFromToken(token: string): User | null {
  const payload = verifyJwt(token);
  if (!payload || payload.type !== "access") return null;

  const mode = getAuthMode();
  if (mode === "none") {
    return {
      id: "auto-user",
      email: process.env.LOCAL_USER_EMAIL || "user@dzeck.ai",
      fullname: process.env.LOCAL_USER_NAME || "Dzeck User",
      role: "admin",
      active: true,
      createdAt: 0,
    };
  }
  if (mode === "local") {
    const email = process.env.LOCAL_USER_EMAIL || "";
    if (payload.email === email) {
      return {
        id: "local-user",
        email,
        fullname: process.env.LOCAL_USER_NAME || "Local User",
        role: "admin",
        active: true,
        createdAt: 0,
      };
    }
    return null;
  }
  // password mode — synchronous path returns a stub; async resolution happens in middleware
  // Return a partial user with ID so downstream can fetch full record if needed
  return {
    id: payload.userId,
    email: payload.email,
    fullname: "",
    role: (payload.role as "user" | "admin") || "user",
    active: true,
    createdAt: 0,
  };
}

function createTokensForUser(user: User): { accessToken: string; refreshToken: string } {
  const accessToken = createJwt({ userId: user.id, email: user.email, role: user.role, type: "access" }, ACCESS_TOKEN_EXPIRE_MINUTES * 60);
  const refreshToken = createJwt({ userId: user.id, email: user.email, role: user.role, type: "refresh" }, REFRESH_TOKEN_EXPIRE_DAYS * 24 * 3600);
  return { accessToken, refreshToken };
}

export function requireAuth(req: any, res: any, next: any) {
  const mode = getAuthMode();
  if (mode === "none") {
    req.user = {
      id: "auto-user",
      email: process.env.LOCAL_USER_EMAIL || "user@dzeck.ai",
      fullname: process.env.LOCAL_USER_NAME || "Dzeck User",
      role: "admin",
      active: true,
    };
    return next();
  }

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  verifyJwtAsync(token).then((payload) => {
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    // Reject password_reset tokens from being used for API authentication
    if (payload.type === "password_reset") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    const user = getUserFromToken(token);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.user = user;
    next();
  }).catch(() => {
    return res.status(401).json({ error: "Invalid or expired token" });
  });
}

export function requireAdmin(req: any, res: any, next: any) {
  requireAuth(req, res, () => {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

export function registerAuthRoutes(app: any) {
  // Startup warning if AUTH_PROVIDER=password but JWT_SECRET not set
  const _startupMode = getAuthMode();
  if (_startupMode !== "none") {
    const _secret = process.env.JWT_SECRET;
    if (!_secret) {
      console.error(
        `[auth] FATAL: AUTH_PROVIDER=${_startupMode} requires JWT_SECRET to be set. ` +
        "Generate one with: openssl rand -hex 32. Server will throw on first auth request.",
      );
    } else if (_secret.length < 32) {
      console.warn(
        `[auth] WARNING: JWT_SECRET is too short (${_secret.length} chars < 32). ` +
        "Use a longer secret for production security.",
      );
    }
  }

  app.get("/api/auth/status", (_req: any, res: any) => {
    res.json({ auth_provider: getAuthMode() });
  });

  app.post("/api/auth/login", async (req: any, res: any) => {
    const { email, password } = req.body || {};
    const mode = getAuthMode();

    if (mode === "none") {
      const user: User = {
        id: "auto-user",
        email: process.env.LOCAL_USER_EMAIL || "user@dzeck.ai",
        fullname: process.env.LOCAL_USER_NAME || "Dzeck User",
        role: "admin",
        active: true,
        createdAt: 0,
      };
      const { accessToken, refreshToken } = createTokensForUser(user);
      return res.json({ user: { id: user.id, email: user.email, fullname: user.fullname, role: user.role }, access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" });
    }

    if (mode === "local") {
      const localEmail = process.env.LOCAL_USER_EMAIL || "";
      const localPass = process.env.LOCAL_USER_PASSWORD || "";
      if (!localEmail || !localPass) {
        return res.status(500).json({ error: "Local auth not configured. Set LOCAL_USER_EMAIL and LOCAL_USER_PASSWORD." });
      }
      if (email !== localEmail || password !== localPass) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const user: User = {
        id: "local-user",
        email: localEmail,
        fullname: process.env.LOCAL_USER_NAME || "Local User",
        role: "admin",
        active: true,
        createdAt: 0,
      };
      const { accessToken, refreshToken } = createTokensForUser(user);
      return res.json({ user: { id: user.id, email: user.email, fullname: user.fullname, role: user.role }, access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" });
    }

    // password mode — look up user in MongoDB
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    try {
      const user = await mongoFindUserByEmail(email);
      if (!user || !user.active) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const valid = await comparePassword(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ error: "Invalid credentials" });
      }
      const { accessToken, refreshToken } = createTokensForUser(user);
      return res.json({ user: { id: user.id, email: user.email, fullname: user.fullname, role: user.role }, access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" });
    } catch (err: any) {
      console.error("[auth/login] Error:", err.message);
      return res.status(503).json({ error: "Authentication service unavailable. Check MONGODB_URI." });
    }
  });

  app.post("/api/auth/register", async (req: any, res: any) => {
    const mode = getAuthMode();
    if (mode !== "password") {
      return res.status(403).json({ error: "Registration is not allowed in this mode" });
    }

    const { email, password, fullname } = req.body || {};
    if (!email || !password || !fullname) {
      return res.status(400).json({ error: "Email, password, and fullname are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    try {
      const existing = await mongoFindUserByEmail(email);
      if (existing) {
        return res.status(409).json({ error: "Email already registered" });
      }

      const id = randomUUID();
      const passwordHash = await hashPassword(password);
      const user: User & { passwordHash: string } = {
        id,
        email,
        fullname,
        role: "user",
        active: true,
        createdAt: Date.now(),
        passwordHash,
      };
      await mongoCreateUser(user);

      const { accessToken, refreshToken } = createTokensForUser(user);
      return res.status(201).json({ user: { id, email, fullname, role: user.role }, access_token: accessToken, refresh_token: refreshToken, token_type: "bearer" });
    } catch (err: any) {
      console.error("[auth/register] Error:", err.message);
      return res.status(503).json({ error: "Registration service unavailable. Check MONGODB_URI." });
    }
  });

  app.post("/api/auth/logout", async (req: any, res: any) => {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      const payload = verifyJwtSync(token);
      const ttl = payload ? Math.max(0, payload.exp - Math.floor(Date.now() / 1000)) : 86400;
      await revokeToken(token, ttl || 86400);
    }
    res.json({ message: "Logged out" });
  });

  app.post("/api/auth/refresh", async (req: any, res: any) => {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: "refresh_token is required" });

    const payload = await verifyJwtAsync(refresh_token);
    if (!payload || payload.type !== "refresh") {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const mode = getAuthMode();
    let outUser: User | null = null;

    if (mode === "none") {
      outUser = { id: "auto-user", email: payload.email, fullname: process.env.LOCAL_USER_NAME || "Dzeck User", role: "admin", active: true, createdAt: 0 };
    } else if (mode === "local") {
      outUser = { id: "local-user", email: payload.email, fullname: process.env.LOCAL_USER_NAME || "Local User", role: "admin", active: true, createdAt: 0 };
    } else {
      try {
        const u = await mongoFindUserById(payload.userId);
        if (u && u.active) outUser = u;
      } catch (err: any) {
        console.error("[auth/refresh] MongoDB lookup failed:", err.message);
        return res.status(503).json({ error: "Authentication service unavailable. Check MONGODB_URI." });
      }
    }

    if (!outUser) return res.status(401).json({ error: "User not found or inactive" });

    const oldTtl = Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
    await revokeToken(refresh_token, oldTtl || 86400);
    const { accessToken, refreshToken: newRefresh } = createTokensForUser(outUser);
    return res.json({ access_token: accessToken, refresh_token: newRefresh, token_type: "bearer" });
  });

  app.get("/api/auth/me", async (req: any, res: any) => {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Authentication required" });

    try {
      const user = await getUserFromTokenAsync(token);
      if (!user) return res.status(401).json({ error: "Invalid or expired token" });
      return res.json({ id: user.id, email: user.email, fullname: user.fullname, role: user.role });
    } catch (err: any) {
      console.error("[auth/me] Error:", err.message);
      return res.status(503).json({ error: "Authentication service unavailable" });
    }
  });

  // ─── Password Reset Request (sends email with token) ─────────────────────
  app.post("/api/auth/request-password-reset", async (req: any, res: any) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });

    const mode = getAuthMode();
    if (mode !== "password") {
      return res.json({ message: "If this email exists, a reset link has been sent." });
    }

    try {
      const user = await mongoFindUserByEmail(email);
      if (!user || !user.active) {
        // Always respond the same to prevent email enumeration
        return res.json({ message: "If this email exists, a reset link has been sent." });
      }

      // Generate a short-lived reset token (15 min) — distinct type so it can't be used as an access token
      const resetToken = createJwt({ userId: user.id, email: user.email, role: user.role, type: "password_reset" }, 15 * 60);
      const resetKey = `password_reset:${user.id}`;
      await redisSet(resetKey, resetToken, 15 * 60);

      // Send email if configured
      const appDomain = process.env.APP_DOMAIN || process.env.REPLIT_DEV_DOMAIN || "localhost:5000";
      const resetUrl = `https://${appDomain}/reset-password?token=${encodeURIComponent(resetToken)}`;

      await sendPasswordResetEmail(email, resetUrl);

      return res.json({ message: "If this email exists, a reset link has been sent." });
    } catch (err: any) {
      console.error("[auth/reset] Error:", err.message);
      return res.status(503).json({ error: "Password reset service unavailable" });
    }
  });

  // ─── Password Reset Confirm (validates token, sets new password) ──────────
  app.post("/api/auth/confirm-password-reset", async (req: any, res: any) => {
    const { token, new_password } = req.body || {};
    if (!token || !new_password) {
      return res.status(400).json({ error: "token and new_password are required" });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const payload = verifyJwtSync(token);
    if (!payload || payload.type !== "password_reset") {
      return res.status(401).json({ error: "Invalid or expired reset token" });
    }

    // Validate the token matches what we stored in Redis
    const resetKey = `password_reset:${payload.userId}`;
    let storedToken: string | null = null;
    try {
      storedToken = await redisGet(resetKey);
    } catch {}

    if (!storedToken || storedToken !== token) {
      return res.status(401).json({ error: "Invalid or expired reset token" });
    }

    try {
      const col = await getCollection("users");
      if (!col) return res.status(503).json({ error: "Database unavailable" });

      const passwordHash = await hashPassword(new_password);
      await (col as any).updateOne(
        { id: payload.userId },
        { $set: { passwordHash, updated_at: new Date() } }
      );

      // Revoke the used reset token
      try { await redisSet(resetKey, "", 1); } catch {}
      await revokeToken(token, 1);

      return res.json({ message: "Password updated successfully" });
    } catch (err: any) {
      console.error("[auth/confirm-reset] Error:", err.message);
      return res.status(503).json({ error: "Password reset failed. Please try again." });
    }
  });

  // ─── Legacy reset endpoint (backward compat) ──────────────────────────────
  app.post("/api/auth/reset-password", (req: any, res: any) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });
    return res.json({ message: "If this email exists, a reset link has been sent." });
  });
}
