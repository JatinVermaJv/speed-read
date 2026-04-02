import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users } from "../db/schema";
import type { JwtPayload } from "../types/shared";

function getJwtSecret(): string {
  const secret = (process.env.JWT_SECRET ?? "").trim();

  if (!secret) {
    throw new Error(
      "JWT_SECRET is required. Set it in the API environment (see api/.env.example)."
    );
  }

  if (secret === "change-me-in-production") {
    throw new Error(
      'JWT_SECRET is set to the insecure placeholder "change-me-in-production".'
    );
  }

  if (process.env.NODE_ENV === "production") {
    if (secret === "change-this-to-a-secure-random-string-in-production") {
      throw new Error(
        "JWT_SECRET is set to the example placeholder. Replace it with a secure random value for production."
      );
    }

    if (secret.length < 32) {
      throw new Error("JWT_SECRET must be at least 32 characters in production.");
    }
  }

  return secret;
}

const JWT_SECRET = getJwtSecret();

export function generateAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
}

export function generateRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized", message: "Missing or invalid authorization header" }, 401);
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return c.json({ error: "unauthorized", message: "Missing bearer token" }, 401);
  }

  try {
    const payload = verifyToken(token);
    c.set("userId", payload.userId);
    c.set("userEmail", payload.email);
    c.set("isAdmin", payload.isAdmin || false);
    await next();
  } catch {
    return c.json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }
}

export async function adminMiddleware(c: Context, next: Next) {
  const userId = c.get("userId") as string;

  // Double-check against the DB (don't rely solely on the JWT claim)
  const [user] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || !user.isAdmin) {
    return c.json({ error: "forbidden", message: "Admin access required" }, 403);
  }

  await next();
}
