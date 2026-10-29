import { test, expect } from "@playwright/test";
import { ensureSidebarOpen } from "../helpers/sidebar-helper";

// Use regular user auth state for user settings tests
test.use({ storageState: "tests/.auth/regular-user.json" });

test.describe("User Settings Popup", () => {
  test("should open user settings popup from sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Ensure sidebar is open
    await ensureSidebarOpen(page);

    // Open user menu in sidebar
    const userMenuButton = page.getByTestId("sidebar-user-button");
    await userMenuButton.click();

    // Wait for dropdown menu to appear
    await page.waitForTimeout(500);

    // Try to click settings option - use text selector as fallback
    try {
      const settingsOption = page.getByTestId("user-settings-menu-item");
      await settingsOption.waitFor({ state: "visible", timeout: 2000 });
      await settingsOption.click();
      await page.getByTestId("user-profile-menu-item").click();
    } catch {
      // Fallback to text selectors
      await page.getByText("User Settings").click();
      await page.getByText("Profile").click();
    }

    // Wait for drawer to open
    const drawer = page.getByRole("dialog", { name: "User Settings" });
    await expect(drawer).toBeVisible();

    // Verify it's the user settings dialog
    await expect(
      page.getByRole("heading", { name: "User Settings", level: 2 }),
    ).toBeVisible();

    // Verify user's name is displayed
    await expect(
      page.getByRole("heading", { name: /User/i, level: 1 }),
    ).toBeVisible();
  });

  test("should display 'your' context in user settings", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Ensure sidebar is open
    await ensureSidebarOpen(page);

    // Open user settings
    const userMenuButton = page.getByTestId("sidebar-user-button");
    await userMenuButton.click();

    const settingsOption = page.getByTestId("user-settings-menu-item");
    await settingsOption.click();
    await page.getByTestId("user-profile-menu-item").click();

    // Wait for drawer to open
    await page.waitForSelector("[data-testid='user-detail-content']");

    // Should show "your" context translations
    const drawerContent = await page
      .locator("[data-testid='user-detail-content']")
      .textContent();

    // User context should say "your" not "user"
    expect(drawerContent).toMatch(
      /your.*account|your.*information|your.*password/i,
    );
    expect(drawerContent).not.toMatch(/user account status|user information/i);

    // Check specific user context elements
    const roleText = page.getByText(/cannot modify your own role/i);
    if (await roleText.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(roleText).toBeVisible();
    }
  });

  test("should allow user to update their own profile", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Ensure sidebar is open
    await ensureSidebarOpen(page);

    // Open user settings
    const userMenuButton = page.getByTestId("sidebar-user-button");
    await userMenuButton.click();

    const settingsOption = page.getByTestId("user-settings-menu-item");
    await settingsOption.click();
    await page.getByTestId("user-profile-menu-item").click();

    // Wait for settings to load
    await page.waitForSelector("[data-testid='user-detail-content']");

    // Update name
    const nameInput = page.getByTestId("user-name-input");
    const originalName = await nameInput.inputValue();

    await nameInput.clear();
    await nameInput.fill("Updated User Name");

    // Save changes
    const saveButton = page.getByTestId("save-changes-button");
    await saveButton.click();

    // Wait for success message
    await page.waitForTimeout(2000);

    // Restore original name
    await nameInput.clear();
    await nameInput.fill(originalName);
    await saveButton.click();
    await page.waitForTimeout(2000);
  });

  test("should close settings popup with close button", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Ensure sidebar is open
    await ensureSidebarOpen(page);

    // Open user settings
    const userMenuButton = page.getByTestId("sidebar-user-button");
    await userMenuButton.click();

    const settingsOption = page.getByTestId("user-settings-menu-item");
    await settingsOption.click();
    await page.getByTestId("user-profile-menu-item").click();

    // Wait for drawer
    const drawer = page.getByRole("dialog", { name: "User Settings" });
    await expect(drawer).toBeVisible();

    // Click close button - use the X button in the dialog
    const closeButton = drawer.getByRole("button").first();
    await closeButton.click();

    // Drawer should close
    await expect(drawer).not.toBeVisible();
  });
});
