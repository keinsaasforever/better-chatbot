/**
 * Browser-based sign-in for the desktop shell.
 *
 * Identity providers refuse OAuth inside embedded web views (Google answers
 * with `disallowed_useragent`, and the Superlog traces showed the app window
 * requesting the Google authorize URL and never reaching the callback). So the
 * app never loads a provider itself:
 *
 * 1. The renderer asks (`auth:start-browser-sign-in`) to sign in. We issue a
 *    random `state`, remember it on disk, and open the web app's sign-in page
 *    in the system browser with `callbackUrl=/desktop/auth/complete?state=…`.
 * 2. The browser completes sign-in normally. The handoff page mints a Better
 *    Auth one-time token and opens `keinsaas://auth/callback?token=…&state=…`.
 * 3. The OS hands that URL to us (`open-url` on macOS, `argv` elsewhere). If
 *    `state` matches what we issued, the main process exchanges the token via
 *    `POST /api/auth/one-time-token/verify` from the default session, so the
 *    `Set-Cookie` lands in the app's own cookie jar, then loads the app.
 *
 * The token never enters a renderer URL or the window history, and only the
 * baked web origin is ever contacted.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { BrowserWindow, app, ipcMain, session, shell } from "electron";
import {
  buildBrowserSignInUrl,
  isDesktopSignInPage,
  parseAuthDeepLink,
} from "./deep-link.js";
import { recordDesktopError } from "./otel.js";
import {
  createPendingSignIn,
  matchPendingSignIn,
  parsePendingSignIn,
  type PendingSignIn,
} from "./pending-sign-in.js";
import { parseSetCookie } from "./set-cookie.js";

export type BrowserSignInFailureReason =
  | "expired"
  | "mismatch"
  | "verify_failed"
  | "network";

const PENDING_FILE_NAME = "pending-sign-in.json";
const SESSION_COOKIE_SUFFIX = "better-auth.session_token";
const OPERATION = "desktop.auth.handoff";

let mainWindow: BrowserWindow | null = null;
let webUrl: string | null = null;
let inFlight = false;
const queuedDeepLinks: string[] = [];

export function setDesktopAuthMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

export function registerDesktopAuthIpcHandlers(url: string): void {
  webUrl = url;

  ipcMain.handle(
    "auth:start-browser-sign-in",
    async (_event, input: { page?: unknown; callbackUrl?: unknown }) => {
      const page = input?.page;
      if (!isDesktopSignInPage(page)) {
        throw new Error("Unknown sign-in page");
      }
      const pending = createPendingSignIn({
        page,
        returnTo: input?.callbackUrl,
      });
      await savePendingSignIn(pending);
      await shell.openExternal(
        buildBrowserSignInUrl({ webUrl: url, page, state: pending.state }),
      );
      return { ok: true };
    },
  );
}

/**
 * Entry point for every `keinsaas://` URL the OS delivers. Safe to call before
 * the window exists: the link is queued and replayed by
 * `flushQueuedDeepLinks()` once bootstrap has a window.
 */
export async function handleAuthDeepLink(url: string): Promise<void> {
  if (!webUrl || !mainWindow || mainWindow.isDestroyed()) {
    queuedDeepLinks.push(url);
    return;
  }

  const link = parseAuthDeepLink(url);
  if (!link) {
    console.warn("[desktop] ignoring unrecognised deep link");
    return;
  }
  if (inFlight) return;
  inFlight = true;

  try {
    const pending = await loadPendingSignIn();
    const match = matchPendingSignIn(pending, link.state, Date.now());

    if (match === "none") {
      console.warn("[desktop] deep link arrived without a pending sign-in");
      focusMainWindow();
      return;
    }
    if (match !== "ok" || !pending) {
      if (match === "expired") await clearPendingSignIn();
      notifyFailure(match === "ok" ? "mismatch" : match);
      return;
    }

    // One shot: whatever happens next, this state cannot be replayed.
    await clearPendingSignIn();

    const result = await verifyOneTimeToken(link.token);
    if (!result.ok) {
      notifyFailure(result.reason);
      return;
    }

    await showSignedIn(pending.returnTo);
  } finally {
    inFlight = false;
  }
}

export function flushQueuedDeepLinks(): void {
  const links = queuedDeepLinks.splice(0, queuedDeepLinks.length);
  for (const link of links) {
    void handleAuthDeepLink(link);
  }
}

export function focusMainWindow(): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (process.platform === "darwin") {
    app.focus({ steal: true });
  }
}

async function verifyOneTimeToken(
  token: string,
): Promise<{ ok: true } | { ok: false; reason: "verify_failed" | "network" }> {
  if (!webUrl) return { ok: false, reason: "network" };
  const origin = new URL(webUrl).origin;
  const verifyUrl = `${origin}/api/auth/one-time-token/verify`;

  let response: Response;
  try {
    response = await session.defaultSession.fetch(verifyUrl, {
      method: "POST",
      // Send and store cookies through the app's own session, so the
      // Set-Cookie on the response is exactly what a page navigation would get.
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        // Better Auth rejects a cookie-bearing POST without an Origin it trusts.
        Origin: origin,
        Referer: `${origin}/`,
      },
      body: JSON.stringify({ token }),
    });
  } catch (error) {
    recordDesktopError(OPERATION, error, { reason: "network" });
    return { ok: false, reason: "network" };
  }

  if (!response.ok) {
    recordDesktopError(
      OPERATION,
      new Error(`one-time-token verify responded ${response.status}`),
      { reason: "verify_failed", status: response.status },
    );
    return { ok: false, reason: "verify_failed" };
  }

  await ensureSessionCookie(response, origin);
  return { ok: true };
}

/**
 * Belt and braces: Chromium should have stored the session cookie from the
 * verify response already. If it did not, apply the Set-Cookie headers by hand
 * so the next navigation is authenticated.
 */
async function ensureSessionCookie(
  response: Response,
  origin: string,
): Promise<void> {
  const cookies = session.defaultSession;
  const existing = await cookies.cookies.get({ url: origin });
  if (existing.some((cookie) => cookie.name.endsWith(SESSION_COOKIE_SUFFIX))) {
    return;
  }

  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies =
    typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];

  for (const raw of setCookies) {
    const parsed = parseSetCookie(raw);
    if (!parsed) continue;
    await cookies.cookies.set({
      url: origin,
      name: parsed.name,
      value: parsed.value,
      path: parsed.path ?? "/",
      secure: parsed.secure,
      httpOnly: parsed.httpOnly,
      sameSite: "lax",
      ...(parsed.expirationDate !== undefined
        ? { expirationDate: parsed.expirationDate }
        : {}),
    });
  }
}

async function showSignedIn(returnTo: string): Promise<void> {
  const window = mainWindow;
  if (!window || window.isDestroyed() || !webUrl) return;
  // `returnTo` is a sanitised in-app path, so this can only resolve within
  // the baked web origin.
  const target = new URL(returnTo, webUrl).toString();
  try {
    await window.loadURL(target);
  } catch (error) {
    recordDesktopError(OPERATION, error, { reason: "load_failed" });
  }
  focusMainWindow();
}

function notifyFailure(reason: BrowserSignInFailureReason): void {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  window.webContents.send("auth:browser-sign-in-failed", { reason });
  focusMainWindow();
}

function pendingFilePath(): string {
  return path.join(app.getPath("userData"), PENDING_FILE_NAME);
}

async function savePendingSignIn(pending: PendingSignIn): Promise<void> {
  const file = pendingFilePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(pending), { mode: 0o600 });
}

async function loadPendingSignIn(): Promise<PendingSignIn | null> {
  try {
    return parsePendingSignIn(await fs.readFile(pendingFilePath(), "utf8"));
  } catch {
    return null;
  }
}

async function clearPendingSignIn(): Promise<void> {
  await fs.rm(pendingFilePath(), { force: true });
}
