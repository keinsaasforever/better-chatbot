import { test, expect } from "@playwright/test";
import { ensureSidebarOpen } from "../helpers/sidebar-helper";

test.describe("User Name Synchronization", () => {
  test.use({ storageState: "tests/.auth/regular-user.json" });

  test("should update sidebar name when user changes their own name", async ({
    page,
  }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Ensure sidebar is open
    await ensureSidebarOpen(page);

    // Get original name from sidebar
    const userMenuButton = page.getByTestId("sidebar-user-button");
    await userMenuButton.click();

    // Wait for dropdown to be visible
    await page.waitForSelector("[data-testid='sidebar-user-name']", {
      state: "visible",
      timeout: 5000,
    });

    const originalName = await page
      .getByTestId("sidebar-user-name")
      .textContent();
    expect(originalName).toBeTruthy();

    // Click on User Settings directly
    const settingsOption = page.getByTestId("user-settings-menu-item");
    await settingsOption.click();
    await page.getByTestId("user-profile-menu-item").click();

    // Wait for settings dialog to open
    await page.waitForSelector("[data-testid='user-name-input']", {
      state: "visible",
      timeout: 5000,
    });

    // Update name
    const newName = `Updated User ${Date.now()}`;
    await page.getByTestId("user-name-input").clear();
    await page.getByTestId("user-name-input").fill(newName);

    // Click save and wait for success
    await page.getByTestId("save-changes-button").click();
    await page.waitForTimeout(1000);

    // Close the settings dialog
    await page.getByTestId("close-user-settings-button").click();
    await page.waitForTimeout(500);

    // Verify sidebar updated
    await page.getByTestId("sidebar-user-button").click();
    await page.waitForSelector("[data-testid='sidebar-user-name']", {
      state: "visible",
      timeout: 5000,
    });

    const updatedName = await page
      .getByTestId("sidebar-user-name")
      .textContent();
    expect(updatedName).toBe(newName);

    // Restore original name
    await page.getByTestId("user-settings-menu-item").click();
    await page.getByTestId("user-profile-menu-item").click();
    await page.waitForSelector("[data-testid='user-name-input']", {
      state: "visible",
      timeout: 5000,
    });
    await page.getByTestId("user-name-input").clear();
    await page
      .getByTestId("user-name-input")
      .fill(originalName || "Test Regular User");
    await page.getByTestId("save-changes-button").click();
    await page.waitForTimeout(1000);
    await page.getByTestId("close-user-settings-button").click();
  });

  test("should update header name when admin changes their own name", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: "tests/.auth/admin.json",
    });
    const page = await context.newPage();

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Ensure sidebar is open
    await ensureSidebarOpen(page);

    // Get original name from sidebar
    const userMenuButton = page.getByTestId("sidebar-user-button");
    await userMenuButton.click();

    // Wait for dropdown to be visible
    await page.waitForSelector("[data-testid='sidebar-user-name']", {
      state: "visible",
      timeout: 5000,
    });

    const originalName = await page
      .getByTestId("sidebar-user-name")
      .textContent();
    expect(originalName).toBeTruthy();

    // Click on User Settings directly
    const settingsOption = page.getByTestId("user-settings-menu-item");
    await settingsOption.click();
    await page.getByTestId("user-profile-menu-item").click();

    // Wait for settings dialog to open
    await page.waitForSelector("[data-testid='user-name-input']", {
      state: "visible",
      timeout: 5000,
    });

    // Update name
    const newAdminName = `Updated Admin ${Date.now()}`;
    await page.getByTestId("user-name-input").clear();
    await page.getByTestId("user-name-input").fill(newAdminName);

    // Click save and wait for success
    await page.getByTestId("save-changes-button").click();
    await page.waitForTimeout(1000);

    // Close the settings dialog
    await page.getByTestId("close-user-settings-button").click();
    await page.waitForTimeout(500);

    // Verify sidebar updated
    await page.getByTestId("sidebar-user-button").click();
    await page.waitForSelector("[data-testid='sidebar-user-name']", {
      state: "visible",
      timeout: 5000,
    });

    const updatedName = await page
      .getByTestId("sidebar-user-name")
      .textContent();
    expect(updatedName).toBe(newAdminName);

    // Restore original name
    await page.getByTestId("user-settings-menu-item").click();
    await page.getByTestId("user-profile-menu-item").click();
    await page.waitForSelector("[data-testid='user-name-input']", {
      state: "visible",
      timeout: 5000,
    });
    await page.getByTestId("user-name-input").clear();
    await page
      .getByTestId("user-name-input")
      .fill(originalName || "Test Admin User");
    await page.getByTestId("save-changes-button").click();
    await page.waitForTimeout(1000);

    await context.close();
  });
});
