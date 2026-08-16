const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase, LATEST_SCHEMA_VERSION } = require("../db");
const { createApp, startServer } = require("../server");

function temporaryDatabase(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "macroflow-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "macroflow.db");
}

async function request(baseUrl, route, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("health endpoints report readiness and the deployed version", async (t) => {
  const runtime = await startServer({
    port: 0,
    dbPath: temporaryDatabase(t),
    jwtSecret: "test-secret",
    releaseVersion: "deadbeef",
  });
  t.after(() => runtime.close());

  const baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;
  const live = await request(baseUrl, "/api/health/live");
  assert.equal(live.response.status, 200);
  assert.deepEqual(live.body, { status: "ok" });

  const ready = await request(baseUrl, "/api/health/ready");
  assert.equal(ready.response.status, 200);
  assert.deepEqual(ready.body, { status: "ready" });

  const version = await request(baseUrl, "/api/health/version");
  assert.equal(version.response.status, 200);
  assert.deepEqual(version.body, { version: "deadbeef" });
});

test("auth, state, and meal data survive an API restart", async (t) => {
  const dbPath = temporaryDatabase(t);
  let runtime = await startServer({ port: 0, dbPath, jwtSecret: "restart-secret" });
  let baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;

  const unauthorized = await request(baseUrl, "/api/state");
  assert.equal(unauthorized.response.status, 401);

  const registration = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: { email: "USER@example.com", password: "password123", name: "Test User" },
  });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.body.user.email, "user@example.com");
  const token = registration.body.token;

  const duplicate = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    body: { email: "user@example.com", password: "password123" },
  });
  assert.equal(duplicate.response.status, 409);

  const state = { macroTargets: { protein: 180 }, marker: "persisted" };
  const stateWrite = await request(baseUrl, "/api/state", {
    method: "PUT",
    token,
    body: { state },
  });
  assert.equal(stateWrite.response.status, 200);

  const created = await request(baseUrl, "/api/meals", {
    method: "POST",
    token,
    body: {
      id: "meal-test",
      name: "Test Bowl",
      protein: 40,
      carbs: 50,
      fat: 10,
      tags: ["test"],
    },
  });
  assert.equal(created.response.status, 201);

  const updated = await request(baseUrl, "/api/meals/meal-test", {
    method: "PUT",
    token,
    body: { name: "Updated Bowl", protein: 41, carbs: 51, fat: 11, tags: ["updated"] },
  });
  assert.equal(updated.response.status, 200);

  await runtime.close();
  runtime = await startServer({ port: 0, dbPath, jwtSecret: "restart-secret" });
  t.after(() => runtime.close());
  baseUrl = `http://127.0.0.1:${runtime.server.address().port}`;

  const login = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email: "user@example.com", password: "password123" },
  });
  assert.equal(login.response.status, 200);

  const me = await request(baseUrl, "/api/auth/me", { token: login.body.token });
  assert.equal(me.body.user.name, "Test User");

  const stateRead = await request(baseUrl, "/api/state", { token: login.body.token });
  assert.deepEqual(stateRead.body.state, state);

  const mealRead = await request(baseUrl, "/api/meals", { token: login.body.token });
  assert.equal(mealRead.body.meals.length, 1);
  assert.equal(mealRead.body.meals[0].name, "Updated Bowl");
  assert.deepEqual(mealRead.body.meals[0].tags, ["updated"]);

  const deleted = await request(baseUrl, "/api/meals/meal-test", {
    method: "DELETE",
    token: login.body.token,
  });
  assert.equal(deleted.response.status, 200);
  const empty = await request(baseUrl, "/api/meals", { token: login.body.token });
  assert.deepEqual(empty.body.meals, []);
});

test("version-zero databases migrate transactionally without losing existing rows", async (t) => {
  const dbPath = temporaryDatabase(t);
  let database = openDatabase(dbPath);
  await database.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await database.run(
    "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
    ["legacy@example.com", "legacy-hash", "Legacy"]
  );
  await database.close();

  database = openDatabase(dbPath);
  t.after(() => database.close());
  const version = await database.initDb();
  assert.equal(version, LATEST_SCHEMA_VERSION);
  assert.equal((await database.get("PRAGMA user_version")).user_version, LATEST_SCHEMA_VERSION);
  assert.equal((await database.get("PRAGMA foreign_keys")).foreign_keys, 1);
  assert.equal((await database.get("PRAGMA busy_timeout")).timeout, 5000);
  assert.equal((await database.get("PRAGMA journal_mode")).journal_mode, "wal");
  assert.equal((await database.get("SELECT name FROM users WHERE email = ?", ["legacy@example.com"])).name, "Legacy");

  const tables = await database.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user_state', 'meals') ORDER BY name"
  );
  assert.deepEqual(tables.map(({ name }) => name), ["meals", "user_state"]);
});

test("a database newer than this API is rejected", async (t) => {
  const database = openDatabase(temporaryDatabase(t));
  t.after(() => database.close());
  await database.run(`PRAGMA user_version = ${LATEST_SCHEMA_VERSION + 1}`);
  await assert.rejects(database.initDb(), /newer than supported/);
});

test("production startup rejects missing or placeholder JWT secrets", async (t) => {
  const database = openDatabase(temporaryDatabase(t));
  t.after(() => database.close());
  const previousNodeEnv = process.env.NODE_ENV;
  const previousJwtSecret = process.env.JWT_SECRET;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
  });
  process.env.NODE_ENV = "production";
  delete process.env.JWT_SECRET;
  assert.throws(() => createApp({ database }), /JWT_SECRET must contain at least 32/);
  assert.throws(() => createApp({ database, jwtSecret: "replace-with-a-secret" }), /JWT_SECRET/);
});
