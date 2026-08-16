const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { openDatabase } = require("./db");

const DEFAULT_PORT = 3000;
const DEFAULT_JWT_SECRET = "dev-only-secret-change-me";

const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

function createApp({
  database,
  jwtSecret,
  releaseVersion =
    process.env.BUILD_VERSION || process.env.APP_VERSION || process.env.GIT_COMMIT || "development",
  serveStatic = process.env.SERVE_STATIC === "1",
} = {}) {
  if (!database) throw new Error("createApp requires a database");
  const signingSecret = jwtSecret || process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
  if (
    process.env.NODE_ENV === "production" &&
    (signingSecret === DEFAULT_JWT_SECRET || signingSecret.startsWith("replace-with-") || signingSecret.length < 32)
  ) {
    throw new Error("JWT_SECRET must contain at least 32 non-placeholder characters in production");
  }

  const { run, get, all } = database;
  const app = express();
  app.locals.ready = false;

  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health/live", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/health/ready", (_req, res) => {
    const ready = app.locals.ready === true;
    return res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready" });
  });
  app.get("/api/health/version", (_req, res) => res.json({ version: releaseVersion }));

  function signToken(user) {
    return jwt.sign({ userId: user.id, email: user.email }, signingSecret, {
      expiresIn: "7d",
    });
  }

  function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      req.user = jwt.verify(token, signingSecret);
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }

  app.post("/api/auth/register", asyncHandler(async (req, res) => {
    const { email, password, name } = req.body || {};
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: "Email and password (>=8 chars) are required." });
    }

    const normalizedEmail = email.toLowerCase();
    const existing = await get("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing) return res.status(409).json({ error: "Email already registered." });

    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
      [normalizedEmail, hash, name || null]
    );
    const user = { id: result.lastID, email: normalizedEmail, name: name || null };
    return res.status(201).json({ token: signToken(user), user });
  }));

  app.post("/api/auth/login", asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await get("SELECT id, email, name, password_hash FROM users WHERE email = ?", [
      email.toLowerCase(),
    ]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    return res.json({
      token: signToken(user),
      user: { id: user.id, email: user.email, name: user.name },
    });
  }));

  app.get("/api/auth/me", authMiddleware, asyncHandler(async (req, res) => {
    const user = await get("SELECT id, email, name FROM users WHERE id = ?", [req.user.userId]);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({ user });
  }));

  app.get("/api/state", authMiddleware, asyncHandler(async (req, res) => {
    const row = await get("SELECT state_json, updated_at FROM user_state WHERE user_id = ?", [
      req.user.userId,
    ]);
    return res.json({
      state: row ? JSON.parse(row.state_json) : null,
      updatedAt: row?.updated_at || null,
    });
  }));

  app.put("/api/state", authMiddleware, asyncHandler(async (req, res) => {
    const { state } = req.body || {};
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      return res.status(400).json({ error: "A valid state object is required." });
    }

    await run(
      `INSERT INTO user_state (user_id, state_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE
       SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP`,
      [req.user.userId, JSON.stringify(state)]
    );
    return res.json({ ok: true });
  }));

  app.get("/api/meals", authMiddleware, asyncHandler(async (req, res) => {
    const rows = await all(
      "SELECT id, name, protein, carbs, fat, tags_json, updated_at FROM meals WHERE user_id = ? ORDER BY updated_at DESC",
      [req.user.userId]
    );
    return res.json({
      meals: rows.map((row) => ({
        id: row.id,
        name: row.name,
        protein: row.protein,
        carbs: row.carbs,
        fat: row.fat,
        tags: JSON.parse(row.tags_json),
        updatedAt: row.updated_at,
      })),
    });
  }));

  app.post("/api/meals", authMiddleware, asyncHandler(async (req, res) => {
    const { id, name, protein, carbs, fat, tags } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: "id and name are required" });

    await run(
      `INSERT INTO meals (id, user_id, name, protein, carbs, fat, tags_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, req.user.userId, name, protein || 0, carbs || 0, fat || 0, JSON.stringify(tags || [])]
    );
    return res.status(201).json({ ok: true });
  }));

  app.put("/api/meals/:id", authMiddleware, asyncHandler(async (req, res) => {
    const { name, protein, carbs, fat, tags } = req.body || {};
    const result = await run(
      `UPDATE meals
       SET name = ?, protein = ?, carbs = ?, fat = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        name,
        protein || 0,
        carbs || 0,
        fat || 0,
        JSON.stringify(tags || []),
        req.params.id,
        req.user.userId,
      ]
    );
    if (!result.changes) return res.status(404).json({ error: "Meal not found" });
    return res.json({ ok: true });
  }));

  app.delete("/api/meals/:id", authMiddleware, asyncHandler(async (req, res) => {
    const result = await run("DELETE FROM meals WHERE id = ? AND user_id = ?", [
      req.params.id,
      req.user.userId,
    ]);
    if (!result.changes) return res.status(404).json({ error: "Meal not found" });
    return res.json({ ok: true });
  }));

  if (serveStatic) app.use(express.static(path.join(__dirname)));

  app.use((error, _req, res, _next) => {
    console.error(error);
    return res.status(500).json({ error: "Unexpected server error." });
  });

  return app;
}

async function startServer({
  port = Number(process.env.PORT || DEFAULT_PORT),
  dbPath = process.env.DB_PATH,
  jwtSecret,
  releaseVersion,
  serveStatic,
} = {}) {
  const database = openDatabase(dbPath);
  const app = createApp({ database, jwtSecret, releaseVersion, serveStatic });

  try {
    await database.initDb();
    app.locals.ready = true;
  } catch (error) {
    await database.close().catch(() => {});
    throw error;
  }

  const server = await new Promise((resolve, reject) => {
    const listener = app.listen(port, () => resolve(listener));
    listener.once("error", reject);
  });

  return {
    app,
    server,
    database,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((serverError) => {
          database.close().then(resolve, reject);
          if (serverError) reject(serverError);
        });
      }),
  };
}

if (require.main === module) {
  startServer()
    .then((runtime) => {
      const address = runtime.server.address();
      console.log(`MacroFlow API listening on port ${address.port}`);

      const shutdown = async () => {
        try {
          await runtime.close();
          process.exit(0);
        } catch (error) {
          console.error(error);
          process.exit(1);
        }
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    })
    .catch((error) => {
      console.error("MacroFlow API failed to start", error);
      process.exit(1);
    });
}

module.exports = { createApp, startServer };
