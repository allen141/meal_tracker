const { test, expect } = require("@playwright/test");
const { AxeBuilder } = require("@axe-core/playwright");

test("registered users persist UI state through the shared API", async ({ page }) => {
  const email = `browser-${Date.now()}@example.com`;

  await page.goto("/#/planner");
  await page.locator(".topbar-account").click();
  await page.getByRole("tab", { name: "Register" }).click();
  await page.locator("#authEmail").fill(email);
  await page.locator("#authPassword").fill("password123");
  await page.locator("#registerBtn").click();
  await expect(page.locator(".topbar-account")).toContainText(email);

  const proteinTarget = page.locator('[data-macro-key="protein"]');
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/state") &&
        response.request().method() === "PUT" &&
        response.ok(),
    ),
    proteinTarget.fill("222"),
  ]);

  await page.evaluate(() => localStorage.removeItem("macroflow-state-v1"));
  await page.reload();
  await expect(page.locator(".topbar-account")).toContainText(email);
  await expect(proteinTarget).toHaveValue("222");
});

test("anonymous users can schedule meals, search the library, and build dated prep batches", async ({ page }) => {
  await page.goto("/#/planner");
  await page.locator(".meal-dock .button-primary").first().click();
  await page.getByRole("button", { name: "Schedule meal" }).click();
  await expect(page.locator(".calendar-scroll .scheduled-meal")).toHaveCount(1);

  await page.locator('.primary-nav a[href="#/meals"]').click();
  await page.locator("#mealSearch").fill("salmon");
  await expect(page.locator(".meal-grid .meal-card")).toHaveCount(1);
  await expect(page.locator(".meal-grid .meal-card")).toContainText("Salmon + Rice + Greens");

  await page.locator('.primary-nav a[href="#/prep"]').click();
  await page.locator("input[type=number]").first().fill("1");
  await page.getByRole("button", { name: "Add dated batch" }).click();
  await expect(page.locator(".saved-batch")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove" }).last().click();
  await expect(page.locator(".saved-batch")).toHaveCount(0);
});

test("meal CRUD and reset use explicit confirmations", async ({ page }) => {
  await page.goto("/#/meals");
  await page.getByRole("button", { name: "+ New meal" }).click();
  await page.locator('input[name="name"]').fill("Test Lentil Bowl");
  await page.locator('input[name="protein"]').fill("30");
  await page.locator('input[name="carbs"]').fill("45");
  await page.locator('input[name="fat"]').fill("8");
  await page.locator('input[name="tags"]').fill("prep:fast, protein:plant");
  await page.getByRole("button", { name: "Save meal" }).click();
  await expect(page.locator(".meal-card").filter({ hasText: "Test Lentil Bowl" })).toHaveCount(1);

  await page.locator(".meal-card").filter({ hasText: "Test Lentil Bowl" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: "Delete meal" })).toBeVisible();
  await page.getByRole("button", { name: "Delete meal" }).click();
  await expect(page.locator(".meal-card").filter({ hasText: "Test Lentil Bowl" })).toHaveCount(0);

  await page.locator(".settings-wrap .icon-button").click();
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByRole("button", { name: "Reset data" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator(".meal-card").first()).toBeVisible();
});

test("planner stays within the viewport and exposes an accessible scheduling path", async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/#/planner");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    expect(overflow, `body overflow at ${viewport.width}px`).toBeTruthy();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/planner");
  await page.locator(".mobile-calendar .add-slot-button").first().click();
  await expect(page.getByRole("button", { name: "Schedule meal" })).toBeVisible();
  await page.getByRole("button", { name: "Schedule meal" }).click();
  await expect(page.locator(".mobile-calendar .scheduled-meal")).toHaveCount(1);
});

test("dark workspace has no automated accessibility violations", async ({ page }) => {
  await page.goto("/#/planner");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("shows the deployed commit hash", async ({ page }) => {
  await page.goto("/#/planner");
  const version = page.locator(".build-version");
  await expect(version).toHaveText(/^[a-z0-9]+$/i);
  await expect(version).toHaveAttribute("title", /^[a-z0-9]+$/i);
});
