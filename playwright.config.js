const os = require("node:os");
const path = require("node:path");
const { defineConfig } = require("@playwright/test");

const port = 4173;
const dbPath = path.join(os.tmpdir(), `macroflow-playwright-${process.pid}.db`);

module.exports = defineConfig({
  testDir: "./tests",
  outputDir: path.join(os.tmpdir(), `macroflow-playwright-results-${process.pid}`),
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: "node server.js",
    url: `http://127.0.0.1:${port}/api/health/ready`,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      JWT_SECRET: "playwright-only-secret-with-at-least-32-characters",
      SERVE_STATIC: "1",
    },
  },
});
