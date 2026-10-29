import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

test.describe("Cockpit", () => {
  test.use({ storageState: TEST_USERS.editor.authFile });

  test("the Work | Cockpit toggle switches between home and /cockpit", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = page.getByRole("tablist", { name: "Workspace mode" });
    await expect(toggle).toBeVisible();
    await expect(toggle.getByRole("tab", { name: "Work" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await toggle.getByRole("tab", { name: "Cockpit" }).click();
    await expect(page).toHaveURL(/\/cockpit$/);
    const cockpitToggle = page.getByRole("tablist", { name: "Workspace mode" });
    await expect(
      cockpitToggle.getByRole("tab", { name: "Cockpit" }),
    ).toHaveAttribute("aria-selected", "true");
    // Every instrument is live or INOP; with no connections, CONNECT is offered.
    await expect(page.getByText("CONNECT").first()).toBeVisible();

    await cockpitToggle.getByRole("tab", { name: "Work" }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("COM 1 opens the voice drawer as the cockpit copilot", async ({
    page,
  }) => {
    // Never reach the realtime provider from e2e: capture the session
    // request, answer it with an error, and only check what was asked for.
    const tokenRequests: Array<Record<string, unknown>> = [];
    await page.route("**/api/chat/openai-realtime**", async (route) => {
      tokenRequests.push(route.request().postDataJSON() ?? {});
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "mocked in e2e" }),
      });
    });

    await page.goto("/cockpit");
    const com1 = page.getByRole("button", {
      name: /Talk to the cockpit copilot/,
    });
    await expect(com1).toBeVisible();
    await expect(com1).toHaveAttribute("data-led", "off");
    await expect(com1).toContainText("COM 1");
    await expect(com1).toContainText("PTT");

    await com1.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => tokenRequests.length).toBeGreaterThan(0);
    expect(tokenRequests[0]).toMatchObject({ context: "cockpit" });
  });
});
