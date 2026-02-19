import type { Context, Next } from "hono";

export async function securityHeaders(c: Context, next: Next) {
  await next();

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload"
  );
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  );
}
