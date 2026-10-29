import { captcha as captchaPlugin } from "better-auth/plugins";

/**
 * The endpoints Cloudflare Turnstile guards.
 *
 * This happens to match the plugin's own default, and is spelled out because
 * the failure mode of an endpoint missing from the list is silent — it is
 * simply unprotected. Add magic-link, email-OTP or verification-resend paths
 * here the moment they exist; a resend endpoint in particular is a free
 * mail-sending endpoint, and the one people forget.
 */
export const CAPTCHA_PROTECTED_ENDPOINTS = [
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
];

/**
 * The Turnstile plugin, or nothing when no secret is configured.
 *
 * Returning an empty list rather than a misconfigured plugin is deliberate:
 * the plugin throws (and the endpoint 500s) if it matches a request while its
 * secret is missing, so a half-populated environment would take sign-in down
 * rather than merely leaving the captcha off. Local dev, self-hosts and a
 * deploy whose env has not been filled in yet all keep working.
 *
 * Note the plugin only implements `onRequest`, which Better Auth runs from the
 * router — requests that reach the endpoints through `auth.api.*` on the
 * server (a server action, say) skip it entirely and are unprotected.
 */
export function buildCaptchaPlugins(
  secretKey: string | undefined,
): ReturnType<typeof captchaPlugin>[] {
  const secret = secretKey?.trim();
  if (!secret) return [];
  return [
    captchaPlugin({
      provider: "cloudflare-turnstile",
      secretKey: secret,
      endpoints: CAPTCHA_PROTECTED_ENDPOINTS,
    }),
  ];
}
