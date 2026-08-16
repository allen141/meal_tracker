const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const DEFAULT_DB_PATH = path.join(__dirname, "macroflow.db");
const LATEST_SCHEMA_VERSION = 1;

function openDatabase(filename = process.env.DB_PATH || DEFAULT_DB_PATH) {
  const db = new sqlite3.Database(filename);

  const run = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(error) {
        if (error) return reject(error);
        return resolve(this);
      });
    });

  const get = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.get(sql, params, (error, row) => {
        if (error) return reject(error);
        return resolve(row);
      });
    });

  const all = (sql, params = []) =>
    new Promise((resolve, reject) => {
      db.all(sql, params, (error, rows) => {
        if (error) return reject(error);
        return resolve(rows);
      });
    });

  const close = () =>
    new Promise((resolve, reject) => {
      db.close((error) => (error ? reject(error) : resolve()));
    });

  async function migrateToVersion1() {
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS user_state (
        user_id INTEGER PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS meals (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        protein INTEGER NOT NULL,
        carbs INTEGER NOT NULL,
        fat INTEGER NOT NULL,
        tags_json TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  }

  async function initDb() {
    await run("PRAGMA foreign_keys = ON");
    await run("PRAGMA busy_timeout = 5000");
    await run("PRAGMA journal_mode = WAL");

    const versionRow = await get("PRAGMA user_version");
    let version = versionRow.user_version;
    if (version > LATEST_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${version} is newer than supported version ${LATEST_SCHEMA_VERSION}`
      );
    }

    if (version < 1) {
      await run("BEGIN IMMEDIATE");
      try {
        await migrateToVersion1();
        await run("PRAGMA user_version = 1");
        await run("COMMIT");
        version = 1;
      } catch (error) {
        await run("ROLLBACK").catch(() => {});
        throw error;
      }
    }

    return version;
  }

  return { db, filename, run, get, all, close, initDb };
}

module.exports = { DEFAULT_DB_PATH, LATEST_SCHEMA_VERSION, openDatabase };
