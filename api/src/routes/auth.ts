import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db } from "../db";
import { users, refreshTokens } from "../db/schema";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
} from "../middleware/auth";
import { authRateLimiter } from "../middleware/rateLimiter";
import type { GoogleUserInfo } from "../types/shared";
import { setCookie, getCookie, deleteCookie } from "hono/cookie";

const auth = new Hono();

// Apply strict rate limiting to all auth routes
auth.use("/*", authRateLimiter());

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createTokens(
  userId: string,
  email: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = generateAccessToken({ userId, email });
  const refreshToken = generateRefreshToken({ userId, email });

  // Hash and store refresh token
  const tokenHash = await bcrypt.hash(refreshToken, 10);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  await db.insert(refreshTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });

  return { accessToken, refreshToken };
}

function setRefreshCookie(c: any, refreshToken: string) {
  setCookie(c, "refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  });
}

// ─── Register ───────────────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

auth.post("/register", zValidator("json", registerSchema), async (c) => {
  const { name, email, password } = c.req.valid("json");

  // Check if user already exists
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return c.json(
      { error: "conflict", message: "Email already registered" },
      409
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db
    .insert(users)
    .values({ name, email, passwordHash })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    });

  const { accessToken, refreshToken } = await createTokens(user.id, user.email);

  setRefreshCookie(c, refreshToken);

  return c.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    },
  });
});

// ─── Login ──────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

auth.post("/login", zValidator("json", loginSchema), async (c) => {
  const { email, password } = c.req.valid("json");

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || !user.passwordHash) {
    return c.json(
      { error: "unauthorized", message: "Invalid email or password" },
      401
    );
  }

  const valid = await bcrypt.compare(password, user.passwordHash);

  if (!valid) {
    return c.json(
      { error: "unauthorized", message: "Invalid email or password" },
      401
    );
  }

  const { accessToken, refreshToken } = await createTokens(user.id, user.email);

  setRefreshCookie(c, refreshToken);

  return c.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    },
  });
});

// ─── Google OAuth ───────────────────────────────────────────────────────────

const googleSchema = z.object({
  credential: z.string().min(1),
});

auth.post("/google", zValidator("json", googleSchema), async (c) => {
  const { credential } = c.req.valid("json");

  // Verify Google ID token
  let googleUser: GoogleUserInfo;
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
    );
    if (!response.ok) throw new Error("Invalid token");
    googleUser = (await response.json()) as GoogleUserInfo;
  } catch {
    return c.json(
      { error: "unauthorized", message: "Invalid Google credential" },
      401
    );
  }

  // Upsert user
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, googleUser.email))
    .limit(1);

  if (!user) {
    // Create new user
    [user] = await db
      .insert(users)
      .values({
        email: googleUser.email,
        name: googleUser.name,
        googleId: googleUser.sub,
        avatarUrl: googleUser.picture || null,
      })
      .returning();
  } else if (!user.googleId) {
    // Link Google account to existing user
    await db
      .update(users)
      .set({
        googleId: googleUser.sub,
        avatarUrl: user.avatarUrl || googleUser.picture || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  }

  const { accessToken, refreshToken } = await createTokens(
    user.id,
    user.email
  );

  setRefreshCookie(c, refreshToken);

  return c.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    },
  });
});

// ─── Refresh Token ──────────────────────────────────────────────────────────

auth.post("/refresh", async (c) => {
  const token = getCookie(c, "refreshToken");

  if (!token) {
    return c.json(
      { error: "unauthorized", message: "No refresh token" },
      401
    );
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return c.json(
      { error: "unauthorized", message: "Invalid refresh token" },
      401
    );
  }

  // Verify token exists in DB
  const storedTokens = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, payload.userId));

  let validToken = false;
  let matchedTokenId: string | null = null;

  for (const stored of storedTokens) {
    if (await bcrypt.compare(token, stored.tokenHash)) {
      if (stored.expiresAt > new Date()) {
        validToken = true;
        matchedTokenId = stored.id;
      }
      break;
    }
  }

  if (!validToken || !matchedTokenId) {
    return c.json(
      { error: "unauthorized", message: "Refresh token expired or revoked" },
      401
    );
  }

  // Rotate: delete old, create new
  await db
    .delete(refreshTokens)
    .where(eq(refreshTokens.id, matchedTokenId));

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, payload.userId))
    .limit(1);

  if (!user) {
    return c.json({ error: "unauthorized", message: "User not found" }, 401);
  }

  const { accessToken, refreshToken: newRefreshToken } = await createTokens(
    user.id,
    user.email
  );

  setRefreshCookie(c, newRefreshToken);

  return c.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    },
  });
});

// ─── Logout ─────────────────────────────────────────────────────────────────

auth.post("/logout", async (c) => {
  const token = getCookie(c, "refreshToken");

  if (token) {
    try {
      const payload = verifyToken(token);
      // Delete all refresh tokens for this user
      await db
        .delete(refreshTokens)
        .where(eq(refreshTokens.userId, payload.userId));
    } catch {
      // Token invalid, just clear cookie
    }
  }

  deleteCookie(c, "refreshToken");

  return c.json({ message: "Logged out" });
});

export default auth;
