const express = require("express");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { run, get, all, initDb } = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname)));

function signToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "7d",
  });
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.post("/api/auth/register", async (req, res) => {
  const { email, password, name } = req.body || {};

  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "Email and password (>=8 chars) are required." });
  }

  const existing = await get("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
  if (existing) return res.status(409).json({ error: "Email already registered." });

  const hash = await bcrypt.hash(password, 10);
  const result = await run(
    "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
    [email.toLowerCase(), hash, name || null]
  );

  const user = {
    id: result.lastID,
    email: email.toLowerCase(),
    name: name || null,
  };

  const token = signToken(user);

  return res.status(201).json({ token, user });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });

  const user = await get("SELECT id, email, name, password_hash FROM users WHERE email = ?", [
    email.toLowerCase(),
  ]);

  if (!user) return res.status(401).json({ error: "Invalid credentials." });

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) return res.status(401).json({ error: "Invalid credentials." });

  const token = signToken(user);
  return res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  const user = await get("SELECT id, email, name FROM users WHERE id = ?", [req.user.userId]);
  if (!user) return res.status(404).json({ error: "User not found" });
  return res.json({ user });
});

app.get("/api/state", authMiddleware, async (req, res) => {
  const row = await get("SELECT state_json, updated_at FROM user_state WHERE user_id = ?", [req.user.userId]);
  return res.json({
    state: row ? JSON.parse(row.state_json) : null,
    updatedAt: row?.updated_at || null,
  });
});

app.put("/api/state", authMiddleware, async (req, res) => {
  const { state } = req.body || {};
  if (!state || typeof state !== "object") {
    return res.status(400).json({ error: "A valid state object is required." });
  }

  const json = JSON.stringify(state);
  await run(
    `INSERT INTO user_state (user_id, state_json, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = CURRENT_TIMESTAMP`,
    [req.user.userId, json]
  );

  return res.json({ ok: true });
});

app.get("/api/meals", authMiddleware, async (req, res) => {
  const rows = await all(
    "SELECT id, name, protein, carbs, fat, tags_json, updated_at FROM meals WHERE user_id = ? ORDER BY updated_at DESC",
    [req.user.userId]
  );
  const meals = rows.map((row) => ({
    id: row.id,
    name: row.name,
    protein: row.protein,
    carbs: row.carbs,
    fat: row.fat,
    tags: JSON.parse(row.tags_json),
    updatedAt: row.updated_at,
  }));
  return res.json({ meals });
});

app.post("/api/meals", authMiddleware, async (req, res) => {
  const { id, name, protein, carbs, fat, tags } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: "id and name are required" });

  await run(
    `INSERT INTO meals (id, user_id, name, protein, carbs, fat, tags_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [id, req.user.userId, name, protein || 0, carbs || 0, fat || 0, JSON.stringify(tags || [])]
  );

  return res.status(201).json({ ok: true });
});

app.put("/api/meals/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { name, protein, carbs, fat, tags } = req.body || {};

  const result = await run(
    `UPDATE meals
     SET name = ?, protein = ?, carbs = ?, fat = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [name, protein || 0, carbs || 0, fat || 0, JSON.stringify(tags || []), id, req.user.userId]
  );

  if (!result.changes) return res.status(404).json({ error: "Meal not found" });

  return res.json({ ok: true });
});

app.delete("/api/meals/:id", authMiddleware, async (req, res) => {
  const result = await run("DELETE FROM meals WHERE id = ? AND user_id = ?", [
    req.params.id,
    req.user.userId,
  ]);

  if (!result.changes) return res.status(404).json({ error: "Meal not found" });

  return res.json({ ok: true });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  return res.status(500).json({ error: "Unexpected server error." });
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`MacroFlow server running on http://localhost:${PORT}`);
  });
});
