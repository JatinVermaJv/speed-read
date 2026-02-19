import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../types/shared";

const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

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

  try {
    const payload = verifyToken(token);
    c.set("userId", payload.userId);
    c.set("userEmail", payload.email);
    await next();
  } catch {
    return c.json({ error: "unauthorized", message: "Invalid or expired token" }, 401);
  }
}
