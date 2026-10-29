import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { signUpPasswordPolicy } from "./signup-password-policy";

const BASE_URL = "http://localhost:3000";

function buildAuth() {
  return betterAuth({
    secret: "signup-password-policy-test-secret-0123456789",
    baseURL: BASE_URL,
    emailAndPassword: { enabled: true },
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    hooks: { before: signUpPasswordPolicy },
  });
}

function signUp(
  auth: ReturnType<typeof buildAuth>,
  email: string,
  password: string,
) {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name: "Test" }),
    }),
  );
}

describe("signUpPasswordPolicy", () => {
  it("rejects a password that fails the complexity rules", async () => {
    // Long enough for Better Auth's own minimum, so only our policy can reject
    // it — no uppercase, digit or special character.
    const res = await signUp(buildAuth(), "weak@example.com", "password");
    expect(res.status).toBe(400);
  });

  it("accepts a compliant password", async () => {
    const res = await signUp(buildAuth(), "strong@example.com", "Sup3rSecret!");
    expect(res.status).toBe(200);
  });

  it("runs on auth.api callers too, not only over the handler", async () => {
    // The captcha plugin's `onRequest` cannot do this; `hooks.before` can, so
    // password policy holds even for server-side sign-ups.
    await expect(
      buildAuth().api.signUpEmail({
        body: { email: "api@example.com", password: "password", name: "Test" },
      }),
    ).rejects.toThrow();
  });
});
