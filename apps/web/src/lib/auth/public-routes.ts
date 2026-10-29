import { callbackUrlQuery, sanitizeCallbackUrl } from "./callback-url";

/**
 * Paths that must stay reachable without a session cookie.
 *
 * The middleware gate is an exact-match allowlist, so every public auth page
 * has to be listed here. `/sign-up/email`, `/forgot-password` and
 * `/reset-password` were missing, which bounced them to a bare `/sign-in` —
 * an invited user who clicked "continue with email" lost the `callbackUrl`
 * carrying their invitation link half-way through sign-up.
 */
const PUBLIC_AUTH_PATHS = new Set([
  "/sign-in",
  "/sign-up",
  "/sign-up/email",
  "/forgot-password",
  "/reset-password",
]);

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.has(pathname);
}

/**
 * Where an unauthenticated request should be sent, preserving the requested
 * page as `callbackUrl` so the user returns to it after signing in. This is
 * what keeps `/accept-invitation/:id` alive across sign-in *and* sign-up: the
 * invite route needs no middleware exemption, it just has to survive the
 * bounce.
 *
 * API paths get a plain redirect — a callback would be meaningless there.
 */
export function signInRedirectPath(pathname: string, search = ""): string {
  if (pathname.startsWith("/api/")) return "/sign-in";
  if (pathname === "/") return "/sign-in";
  const callbackUrl = sanitizeCallbackUrl(`${pathname}${search}`);
  return `/sign-in${callbackUrlQuery(callbackUrl)}`;
}
