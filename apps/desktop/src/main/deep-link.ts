/**
 * The `keinsaas://` URL the web app hands back to the desktop shell after a
 * sign-in that ran in the system browser.
 *
 * Identity providers refuse OAuth inside embedded web views (Google answers
 * with `disallowed_useragent`), so the desktop app never loads the consent
 * screen itself. It opens the sign-in page in the user's browser, the browser
 * finishes the OAuth round trip, and `/desktop/auth/complete` sends the user
 * back here with a one-time token that the main process exchanges for a
 * session cookie (see ./desktop-auth.ts).
 *
 * Pure module: no `electron` import, so it is unit-testable.
 */

export const DESKTOP_PROTOCOL = "keinsaas";

/** Web route that mints the one-time token and renders the deep link. */
export const DESKTOP_HANDOFF_PATH = "/desktop/auth/complete";

export type DesktopSignInPage = "sign-in" | "sign-up";

const SIGN_IN_PAGES: ReadonlySet<string> = new Set(["sign-in", "sign-up"]);

export function isDesktopSignInPage(
  value: unknown,
): value is DesktopSignInPage {
  return typeof value === "string" && SIGN_IN_PAGES.has(value);
}

/**
 * The nonce the main process issues when it opens the browser. Must match
 * `STATE_PATTERN` in `apps/web/src/lib/auth/desktop-handoff.ts`.
 */
const STATE_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;

export function isValidDesktopState(value: unknown): value is string {
  return typeof value === "string" && STATE_PATTERN.test(value);
}

const TOKEN_MIN_LENGTH = 16;
const TOKEN_MAX_LENGTH = 256;

export type AuthDeepLink = {
  token: string;
  state: string;
};

/**
 * Parses `keinsaas://auth/callback?token=…&state=…`. Anything else — another
 * scheme, another path, a missing or malformed parameter — yields `null`.
 * Never throws: the URL comes from the OS and may be anything.
 */
export function parseAuthDeepLink(url: string): AuthDeepLink | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${DESKTOP_PROTOCOL}:`) return null;
  if (parsed.hostname !== "auth") return null;
  // Windows occasionally appends a trailing slash when it launches a protocol
  // handler, so accept both spellings.
  if (parsed.pathname !== "/callback" && parsed.pathname !== "/callback/") {
    return null;
  }

  const token = parsed.searchParams.get("token") ?? "";
  const state = parsed.searchParams.get("state") ?? "";

  if (token.length < TOKEN_MIN_LENGTH || token.length > TOKEN_MAX_LENGTH) {
    return null;
  }
  if (!isValidDesktopState(state)) return null;

  return { token, state };
}

const DEEP_LINK_PREFIX = `${DESKTOP_PROTOCOL}://`;

/**
 * Windows and Linux deliver a protocol launch as a trailing `argv` entry (both
 * on cold start and through `second-instance`). macOS uses `open-url` instead
 * and never puts it in `argv`.
 */
export function findDeepLinkArg(argv: readonly string[]): string | undefined {
  for (let i = argv.length - 1; i >= 0; i -= 1) {
    const arg = argv[i];
    if (typeof arg === "string" && arg.startsWith(DEEP_LINK_PREFIX)) {
      return arg;
    }
  }
  return undefined;
}

/**
 * The page the system browser opens. The `callbackUrl` is the handoff route
 * carrying the nonce, so whichever way the user signs in there (a provider or
 * email + password) they land on `/desktop/auth/complete` afterwards.
 */
export function buildBrowserSignInUrl(input: {
  webUrl: string;
  page: DesktopSignInPage;
  state: string;
}): string {
  const origin = new URL(input.webUrl).origin;
  const handoff = `${DESKTOP_HANDOFF_PATH}?state=${encodeURIComponent(input.state)}`;
  return `${origin}/${input.page}?callbackUrl=${encodeURIComponent(handoff)}`;
}
