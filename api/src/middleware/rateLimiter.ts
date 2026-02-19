import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000);

interface RateLimitOptions {
  windowMs?: number; // time window in ms (default 60s)
  max?: number; // max requests per window (default 100)
}

export function rateLimiter(options: RateLimitOptions = {}) {
  const { windowMs = 60 * 1000, max = 100 } = options;

  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for") ||
      c.req.header("x-real-ip") ||
      "unknown";

    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      return c.json(
        {
          error: "too_many_requests",
          message: "Rate limit exceeded. Please try again later.",
        },
        429
      );
    }

    await next();
  };
}

// Stricter rate limiter for auth endpoints
export function authRateLimiter() {
  return rateLimiter({ windowMs: 15 * 60 * 1000, max: 20 }); // 20 req / 15 min
}
