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

// ─── Global Middleware ──────────────────────────────────────────────────────

// Request logging
app.use("*", logger());

// CORS
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

// Security headers
app.use("*", securityHeaders);

// Global rate limiter (100 req / 60s per IP)
app.use("*", rateLimiter({ windowMs: 60 * 1000, max: 100 }));

// ─── Routes ─────────────────────────────────────────────────────────────────

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
