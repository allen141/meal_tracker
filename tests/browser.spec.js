const { test, expect } = require("@playwright/test");

test("registered users persist UI state through the shared API", async ({ page }) => {
  const email = `browser-${Date.now()}@example.com`;

  await page.goto("/");
  await page.locator("#authEmail").fill(email);
  await page.locator("#authPassword").fill("password123");
  await page.locator("#registerBtn").click();
  await expect(page.locator("#authStatus")).toContainText(`Logged in as ${email}`);

  const proteinTarget = page.locator('[data-macro-key="protein"]');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/state") &&
        response.request().method() === "PUT" &&
        response.ok()
    ),
    proteinTarget.fill("222"),
  ]);

  await page.evaluate(() => localStorage.removeItem("macroflow-state-v1"));
  await page.reload();
  await expect(page.locator("#authStatus")).toContainText("Server sync on");
  await expect(proteinTarget).toHaveValue("222");
});
