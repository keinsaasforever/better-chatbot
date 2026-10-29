import { expect, test } from "@playwright/test";
import { TEST_USERS } from "../constants/test-users";

const INVITE_PATH = "/accept-invitation/11111111-1111-4111-8111-111111111111";
const ENCODED_INVITE = encodeURIComponent(INVITE_PATH);

test.describe("Invitation link survives the authentication detour", () => {
  test("an unauthenticated invite link keeps the invitation as callbackUrl", async ({
    page,
  }) => {
    await page.goto(INVITE_PATH);
    await page.waitForLoadState("networkidle");

    const url = new URL(page.url());
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("callbackUrl")).toBe(INVITE_PATH);
  });

  test("the sign-in page links to sign-up with the callback attached", async ({
    page,
  }) => {
    await page.goto(`/sign-in?callbackUrl=${ENCODED_INVITE}`);
    await page.waitForLoadState("networkidle");

    const signUpLink = page.locator(`a[href*="/sign-up"]`).first();
    await expect(signUpLink).toHaveAttribute(
      "href",
      new RegExp(`callbackUrl=${encodeURIComponent(ENCODED_INVITE)}`),
    );
  });

  test("the email sign-up step is reachable without a session and keeps the callback", async ({
    page,
  }) => {
    // Regression: /sign-up/email was missing from the middleware allowlist, so
    // an unauthenticated user was bounced to a bare /sign-in and the invitation
    // link was lost mid-signup.
    await page.goto(`/sign-up/email?callbackUrl=${ENCODED_INVITE}`);
    await page.waitForLoadState("networkidle");

    const url = new URL(page.url());
    expect(url.pathname).toBe("/sign-up/email");
    expect(url.searchParams.get("callbackUrl")).toBe(INVITE_PATH);
  });

  test("the sign-up page hands the callback to the email step", async ({
    page,
  }) => {
    await page.goto(`/sign-up?callbackUrl=${ENCODED_INVITE}`);
    await page.waitForLoadState("networkidle");

    const emailLink = page.locator(`a[href*="/sign-up/email"]`).first();
    await expect(emailLink).toHaveAttribute(
      "href",
      new RegExp(`callbackUrl=${encodeURIComponent(ENCODED_INVITE)}`),
    );
  });
});

test.describe("The invitation dialog is reachable, whatever the credits say", () => {
  test.use({ storageState: TEST_USERS.regular.authFile });

  test("nothing is layered over the invitation decision", async ({ page }) => {
    // Regression: `AppShell` mounted the usage-limit guard, so an invited user
    // whose personal credits were exhausted got a non-dismissible "usage limit
    // reached" modal portalled on top of this dialog — and could never join the
    // organization whose credits would have replaced that allowance.
    await page.goto(INVITE_PATH);
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("invitation-dialog")).toBeVisible();
    await expect(page.getByTestId("usage-limit-dialog")).toHaveCount(0);

    // Playwright's actionability check fails on a covered element, so a click
    // that lands is the assertion: this invitation id is unknown, so the dialog
    // shows the "no longer valid" card with a single continue button.
    await page.getByRole("button").first().click();
    await expect(page).not.toHaveURL(new RegExp("/accept-invitation/"));
  });
});
