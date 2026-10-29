/**
 * The sign-in the desktop shell is waiting on while the user is in the system
 * browser. Binds the eventual `keinsaas://` deep link to the click that opened
 * the browser: a link whose `state` does not match the pending nonce is
 * ignored, so nobody can push a foreign session into the app by getting the
 * user to open a crafted link.
 *
 * Pure module: no `electron` import, so it is unit-testable. Persistence lives
 * in ./desktop-auth.ts.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isDesktopSignInPage, type DesktopSignInPage } from "./deep-link.js";

export const PENDING_SIGN_IN_TTL_MS = 10 * 60 * 1000;

export type PendingSignIn = {
  state: string;
  createdAt: number;
  expiresAt: number;
  page: DesktopSignInPage;
  /** In-app path to load once the session cookie is in place. */
  returnTo: string;
};

export type PendingSignInMatch = "ok" | "none" | "expired" | "mismatch";

/** 24 random bytes → 32 base64url characters. */
function defaultRandomState(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * Same rule as `sanitizeCallbackUrl` in the web app: a single leading "/" and
 * nothing that a browser would read as protocol-relative. Anything else falls
 * back to the app root.
 */
export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}

export function createPendingSignIn(input: {
  page: DesktopSignInPage;
  returnTo?: unknown;
  now?: number;
  randomState?: () => string;
}): PendingSignIn {
  const now = input.now ?? Date.now();
  return {
    state: (input.randomState ?? defaultRandomState)(),
    createdAt: now,
    expiresAt: now + PENDING_SIGN_IN_TTL_MS,
    page: input.page,
    returnTo: sanitizeReturnTo(input.returnTo),
  };
}

export function matchPendingSignIn(
  pending: PendingSignIn | null | undefined,
  state: string,
  now: number,
): PendingSignInMatch {
  if (!pending) return "none";
  const expected = Buffer.from(pending.state, "utf8");
  const actual = Buffer.from(state, "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return "mismatch";
  }
  if (now > pending.expiresAt) return "expired";
  return "ok";
}

/**
 * Validates what was read back from disk. A missing or corrupt file is simply
 * "nothing pending".
 */
export function parsePendingSignIn(
  raw: string | null | undefined,
): PendingSignIn | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.state !== "string" || record.state.length === 0) {
    return null;
  }
  if (
    typeof record.createdAt !== "number" ||
    typeof record.expiresAt !== "number" ||
    !Number.isFinite(record.createdAt) ||
    !Number.isFinite(record.expiresAt)
  ) {
    return null;
  }
  if (!isDesktopSignInPage(record.page)) return null;
  return {
    state: record.state,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    page: record.page,
    returnTo: sanitizeReturnTo(record.returnTo),
  };
}
