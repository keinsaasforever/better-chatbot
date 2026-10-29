/**
 * Cloudflare Turnstile wiring for the Better Auth captcha plugin.
 *
 * The bot signups this defends against never load the page — they POST the
 * auth endpoint directly. Only a server-side check inside the auth handler
 * stops them, which is exactly what the captcha plugin does; a WAF, a rate
 * limit (they run slow enough never to trip one) and a browser-side captcha
 * all miss them.
 *
 * Both halves are keyed off env vars and stay off when unset, so local dev, a
 * self-host, and a deploy whose env is not populated yet keep working instead
 * of rejecting every sign-in. Cloudflare's always-passing test keys
 * (`1x00000000000000000000AA` / `1x0000000000000000000000000000000AA`) are the
 * way to exercise the wiring locally without hitting Cloudflare.
 */

/**
 * Public Turnstile site key. `NEXT_PUBLIC_*` is inlined at build time, so this
 * has to stay a static member access, and changing the value in Vercel does
 * nothing until the affected environments are redeployed. Set it on Preview
 * *and* Production — a Production-only value makes every staging test lie.
 */
export const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || "";

/** The header the Better Auth captcha plugin reads the token from. */
export const CAPTCHA_HEADER = "x-captcha-response";

/** Fetch headers carrying the widget's token, or none when we have no token. */
export function captchaHeaders(
  token: string | null | undefined,
): Record<string, string> {
  return token ? { [CAPTCHA_HEADER]: token } : {};
}

/**
 * Whether the submit button may be pressed.
 *
 * Deliberately permissive: a widget that failed to load or was blocked counts
 * as ready. Hard-disabling submit on a widget error turns a broken or
 * ad-blocked challenge into a total lockout, which is worse than the bots —
 * and if the server rejects the tokenless request, it at least says why. The
 * only state that blocks is "the widget is still working on a token".
 */
export function captchaSubmitReady({
  configured,
  token,
  errored,
}: {
  configured: boolean;
  token: string | null;
  errored: boolean;
}): boolean {
  if (!configured) return true;
  return errored || token !== null;
}
