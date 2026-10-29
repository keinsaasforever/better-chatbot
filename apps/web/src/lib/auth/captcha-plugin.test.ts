import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import {
  CAPTCHA_PROTECTED_ENDPOINTS,
  buildCaptchaPlugins,
} from "./captcha-plugin";

const BASE_URL = "http://localhost:3000";

/**
 * A throwaway Better Auth instance carrying the same captcha configuration the
 * app ships, on an in-memory store. No network is reached: every assertion
 * below exercises the "no token supplied" branch, which the plugin rejects
 * before it ever calls Cloudflare.
 */
function buildAuth(secretKey: string | undefined) {
  return betterAuth({
    secret: "captcha-plugin-test-secret-value-0123456789",
    baseURL: BASE_URL,
    emailAndPassword: { enabled: true },
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    plugins: buildCaptchaPlugins(secretKey),
  });
}

function signUpRequest(email: string) {
  return new Request(`${BASE_URL}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Sup3rSecret!", name: "Test" }),
  });
}

describe("buildCaptchaPlugins", () => {
  it("stays off when no secret is configured, rather than breaking sign-up", async () => {
    expect(buildCaptchaPlugins(undefined)).toEqual([]);
    expect(buildCaptchaPlugins("   ")).toEqual([]);

    const res = await buildAuth(undefined).handler(
      signUpRequest("unconfigured@example.com"),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a sign-up POST that carries no captcha token", async () => {
    const res = await buildAuth("turnstile-secret").handler(
      signUpRequest("bot@example.com"),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "MISSING_RESPONSE",
    });
  });

  it("guards sign-in and password reset as well as sign-up", () => {
    expect(CAPTCHA_PROTECTED_ENDPOINTS).toEqual([
      "/sign-up/email",
      "/sign-in/email",
      "/request-password-reset",
    ]);
  });

  it("does NOT cover auth.api calls — the reason sign-up runs over the handler", async () => {
    // The plugin only implements `onRequest`, which Better Auth runs from the
    // router. A server action calling `auth.api.signUpEmail` therefore creates
    // an account with no captcha check at all. This test exists so that
    // reintroducing such a server action is a deliberate act, not an accident.
    const auth = buildAuth("turnstile-secret");

    await expect(
      auth.api.signUpEmail({
        body: {
          email: "server-action@example.com",
          password: "Sup3rSecret!",
          name: "Test",
        },
      }),
    ).resolves.toMatchObject({
      user: { email: "server-action@example.com" },
    });
  });
});
