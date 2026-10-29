/**
 * Hand a sign-in that ran in the system browser back to the desktop app.
 *
 * Identity providers refuse OAuth inside embedded web views (Google answers
 * with `disallowed_useragent`), so the Electron shell opens the sign-in page
 * in the user's browser with `callbackUrl=/desktop/auth/complete?state=<nonce>`.
 * That page mints a Better Auth one-time token and sends the browser to the
 * `keinsaas://` link built here; the desktop main process exchanges the token
 * for the session cookie (`apps/desktop/src/main/desktop-auth.ts`).
 *
 * Keep the constants in sync with `apps/desktop/src/main/deep-link.ts`.
 */

export const DESKTOP_PROTOCOL = "keinsaas";
export const DESKTOP_HANDOFF_PATH = "/desktop/auth/complete";

/** Nonce issued by the desktop main process: 24 random bytes as base64url. */
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export function isValidDesktopState(
  value: string | string[] | undefined | null,
): value is string {
  return typeof value === "string" && STATE_PATTERN.test(value);
}

/** `keinsaas://auth/callback?token=…&state=…` */
export function buildDesktopCallbackUrl(input: {
  token: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    token: input.token,
    state: input.state,
  });
  return `${DESKTOP_PROTOCOL}://auth/callback?${params.toString()}`;
}

/** The in-app path the desktop shell passes as `callbackUrl`. */
export function buildDesktopHandoffPath(state: string): string {
  return `${DESKTOP_HANDOFF_PATH}?state=${encodeURIComponent(state)}`;
}
