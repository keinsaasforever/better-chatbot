"use client";

import {
  TURNSTILE_SITE_KEY,
  captchaHeaders,
  captchaSubmitReady,
} from "@/lib/auth/captcha";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useCallback, useRef, useState } from "react";

/**
 * Cloudflare Turnstile for the auth forms. Renders nothing and blocks nothing
 * when no site key is configured, so local dev and self-hosts are unaffected.
 *
 * Three rules here are not obvious and each one has cost a production
 * incident elsewhere:
 *
 *  - Tokens are single-use (~300s), so `reset()` has to run after *every*
 *    submit. Skip it and the second attempt replays a spent token: the
 *    captcha "works once, then the form is dead".
 *  - `onExpire` must only clear the token, never `reset()`. Turnstile
 *    auto-refreshes an expired token (`refreshExpired` defaults to `"auto"`)
 *    and resetting into that in-flight refresh can abort it, so no new token
 *    ever arrives.
 *  - An errored widget must not disable submit — see `captchaSubmitReady`.
 */
export function useCaptcha() {
  const t = useTranslations("Auth.Captcha");
  const { resolvedTheme } = useTheme();
  const ref = useRef<TurnstileInstance | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [errored, setErrored] = useState(false);

  const reset = useCallback(() => {
    setToken(null);
    ref.current?.reset();
  }, []);

  const widget = TURNSTILE_SITE_KEY ? (
    <div className="flex flex-col gap-2">
      <Turnstile
        ref={ref}
        siteKey={TURNSTILE_SITE_KEY}
        // Themed from the app's theme, not the OS default, or a dark widget
        // lands in a light card.
        options={{ theme: resolvedTheme === "dark" ? "dark" : "light" }}
        onSuccess={(next) => {
          setToken(next);
          setErrored(false);
        }}
        onExpire={() => setToken(null)}
        onError={() => {
          setToken(null);
          setErrored(true);
        }}
      />
      {/* Without a visible surface a widget failure is invisible: no token,
          and nothing on screen explaining why the attempt was rejected. */}
      {errored && (
        <p className="text-destructive text-xs" role="alert">
          {t("failed")}
        </p>
      )}
    </div>
  ) : null;

  return {
    widget,
    reset,
    ready: captchaSubmitReady({
      configured: Boolean(TURNSTILE_SITE_KEY),
      token,
      errored,
    }),
    headers: captchaHeaders(token),
  };
}
