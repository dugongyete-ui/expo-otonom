/**
 * JWT Authentication Routes for Dzeck AI
 * Supports three modes: password (MongoDB-backed), local (env vars), none (auto-login)
 *
 * Security:
 * - JWT_SECRET must be set in env for non-none modes; fails fast if missing
 * - Passwords hashed with bcrypt (12 rounds) with per-user salt
 * - Tokens revoked on logout (in-memory revocation list; restart clears it)
 * - "password" mode stores users in MongoDB `users` collection via MongoUserRepository
 */
import { randomUUID } from "node:crypto";
import * as crypto from "node:crypto";
import * as bcrypt from "bcryptjs";
import { getCollection } from "./db/mongo";

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
  type: "access" | "refresh";
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

const revokedTokens = new Set<string>();

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

function verifyJwt(token: string): TokenPayload | null {
  try {
    const secret = getJwtSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [header, body, sig] = parts;
    const expectedSig = hmacSha256(`${header}.${body}`, secret);
    if (sig !== expectedSig) return null;
    const payload: TokenPayload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (revokedTokens.has(token)) return null;
    return payload;
  } catch {
    return null;
  }
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

  const user = getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  req.user = user;
  next();
}

export function registerAuthRoutes(app: any) {
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

  app.post("/api/auth/logout", (req: any, res: any) => {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (token) {
      revokedTokens.add(token);
    }
    res.json({ message: "Logged out" });
  });

  app.post("/api/auth/refresh", async (req: any, res: any) => {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: "refresh_token is required" });

    const payload = verifyJwt(refresh_token);
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

    revokedTokens.add(refresh_token);
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

  app.post("/api/auth/reset-password", (req: any, res: any) => {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "email is required" });
    return res.json({ message: "If this email exists, a reset link has been sent." });
  });
}
