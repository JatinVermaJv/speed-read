import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { securityHeaders } from "./middleware/securityHeaders";
import { rateLimiter } from "./middleware/rateLimiter";
import authRoutes from "./routes/auth";
import passagesRoutes from "./routes/passages";
import sessionsRoutes from "./routes/sessions";
import adminRoutes from "./routes/admin";
import unseenRoutes from "./routes/unseen";
import languageRoutes from "./routes/language";

const app = new Hono();

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, "");
}

const corsOriginEnv = (process.env.CORS_ORIGIN ?? "").trim();
const configuredOrigins = corsOriginEnv
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const allowAnyOrigin = configuredOrigins.includes("*");

if (allowAnyOrigin && process.env.NODE_ENV === "production") {
  throw new Error(
    'CORS_ORIGIN="*" is not allowed in production when credentials are enabled. Set CORS_ORIGIN to your exact frontend origin (e.g. https://your-app.vercel.app).'
  );
}

if (process.env.NODE_ENV === "production" && configuredOrigins.length === 0) {
  throw new Error(
    "CORS_ORIGIN is required in production (e.g. https://your-app.vercel.app)."
  );
}

const devFallbackOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
const allowedOrigins =
  configuredOrigins.length > 0 && !allowAnyOrigin
    ? configuredOrigins
    : devFallbackOrigins;

// ─── Global Middleware ──────────────────────────────────────────────────────

// Request logging
app.use("*", logger());

// CORS
app.use(
  "*",
  cors({
    origin: (origin) => {
      const requestOrigin = normalizeOrigin(origin ?? "");
      if (!requestOrigin) return null;

      if (allowAnyOrigin) {
        return requestOrigin;
      }

      return allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Security headers
app.use("*", securityHeaders);

// Global rate limiter (100 req / 60s per IP)
app.use("*", rateLimiter({ windowMs: 60 * 1000, max: 100 }));

// ─── Routes ─────────────────────────────────────────────────────────────────

app.get("/", (c) => {
  return c.json({ name: "speed-read-api", status: "ok" });
});

app.route("/auth", authRoutes);
app.route("/passages", passagesRoutes);
app.route("/sessions", sessionsRoutes);
app.route("/admin", adminRoutes);
app.route("/unseen", unseenRoutes);
app.route("/language", languageRoutes);

// ─── Health Check ───────────────────────────────────────────────────────────

app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ─── Error Handler ──────────────────────────────────────────────────────────

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "internal_server_error",
      message:
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : err.message,
    },
    500
  );
});

// ─── 404 ────────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json(
    { error: "not_found", message: "Route not found" },
    404
  );
});

// ─── Start Server ───────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || "3001");

console.log(`🚀 Speed-Read API running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
