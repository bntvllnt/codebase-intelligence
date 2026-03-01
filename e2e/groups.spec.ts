import { test, expect } from "@playwright/test";

test.describe("Group Selection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("canvas", { timeout: 15_000 });
  });

  test("legend shows Groups section with group names", async ({ page }) => {
    await expect(page.getByText("Groups", { exact: false })).toBeVisible();

    // Fixture has 5 groups: services, models, utils, src, types
    const groupButtons = page.locator("button[data-group]");
    await expect(groupButtons).toHaveCount(5);

    const names = await groupButtons.locator("span.truncate").allTextContents();
    expect(names).toContain("services");
    expect(names).toContain("models");
    expect(names).toContain("utils");
  });

  test("clicking a group selects it and shows selection count", async ({ page }) => {
    const servicesBtn = page.locator("button[data-group='services']");
    await expect(servicesBtn).toBeVisible();

    await servicesBtn.click();

    // Header should show "(1 selected)"
    await expect(page.getByText("1 selected")).toBeVisible();

    // The clicked button should have highlighted background
    await expect(servicesBtn).not.toHaveClass(/opacity-40/);

    // Other groups should be dimmed
    const modelsBtn = page.locator("button[data-group='models']");
    await expect(modelsBtn).toHaveClass(/opacity-40/);
  });

  test("clicking a selected group deselects it", async ({ page }) => {
    const servicesBtn = page.locator("button[data-group='services']");

    // Select
    await servicesBtn.click();
    await expect(page.getByText("1 selected")).toBeVisible();

    // Deselect
    await servicesBtn.click();

    // "selected" text should be gone
    await expect(page.getByText("selected")).not.toBeVisible();

    // No group should be dimmed
    const allButtons = page.locator("button[data-group]");
    const count = await allButtons.count();
    for (let i = 0; i < count; i++) {
      await expect(allButtons.nth(i)).not.toHaveClass(/opacity-40/);
    }
  });

  test("multi-select: clicking two groups selects both", async ({ page }) => {
    const servicesBtn = page.locator("button[data-group='services']");
    const modelsBtn = page.locator("button[data-group='models']");

    await servicesBtn.click();
    await modelsBtn.click();

    await expect(page.getByText("2 selected")).toBeVisible();

    // Both should not be dimmed
    await expect(servicesBtn).not.toHaveClass(/opacity-40/);
    await expect(modelsBtn).not.toHaveClass(/opacity-40/);

    // Others should be dimmed
    const utilsBtn = page.locator("button[data-group='utils']");
    await expect(utilsBtn).toHaveClass(/opacity-40/);
  });

  test("deselecting one of two selected groups keeps the other", async ({ page }) => {
    const servicesBtn = page.locator("button[data-group='services']");
    const modelsBtn = page.locator("button[data-group='models']");

    await servicesBtn.click();
    await modelsBtn.click();
    await expect(page.getByText("2 selected")).toBeVisible();

    // Deselect services
    await servicesBtn.click();
    await expect(page.getByText("1 selected")).toBeVisible();

    // Services should now be dimmed, models still selected
    await expect(servicesBtn).toHaveClass(/opacity-40/);
    await expect(modelsBtn).not.toHaveClass(/opacity-40/);
  });

  test("group buttons have correct data-group attributes", async ({ page }) => {
    const groupButtons = page.locator("button[data-group]");
    const attrs = await groupButtons.evaluateAll(
      (els) => els.map((el) => el.getAttribute("data-group")),
    );
    expect(attrs.length).toBe(5);
    expect(attrs).toEqual(expect.arrayContaining(["services", "models", "utils", "src", "types"]));
  });

  test("groups only visible when Module Clouds checkbox is checked", async ({ page }) => {
    // Groups should be visible initially (checkbox is checked by default)
    await expect(page.getByText("Groups", { exact: false })).toBeVisible();

    // Uncheck Module Clouds
    const checkbox = page.locator("input[type='checkbox']");
    await checkbox.uncheck();

    // Groups section should disappear
    await expect(page.locator("button[data-group]").first()).not.toBeVisible();
  });
});
