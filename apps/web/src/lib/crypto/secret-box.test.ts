import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { open, seal, isSecretBoxAvailable } = await import("./secret-box");

describe("secret-box", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.APP_SECRETS_KEY = randomBytes(32).toString("base64");
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("round-trips a JSON value and never stores it in the clear", () => {
    const sealed = seal({ restrictedKey: "rk_test_123" });
    expect(sealed).not.toContain("rk_test_123");
    expect(open(sealed)).toEqual({ restrictedKey: "rk_test_123" });
  });

  it("uses a fresh IV per seal", () => {
    expect(seal("same")).not.toEqual(seal("same"));
  });

  it("rejects a tampered payload", () => {
    const buf = Buffer.from(seal({ a: 1 }), "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => open(buf.toString("base64"))).toThrow();
  });

  it("rejects a value sealed with another key", () => {
    const sealed = seal({ a: 1 });
    process.env.APP_SECRETS_KEY = randomBytes(32).toString("base64");
    expect(() => open(sealed)).toThrow();
  });

  it("refuses to work in production without a key", () => {
    delete process.env.APP_SECRETS_KEY;
    delete process.env.BETTER_AUTH_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(isSecretBoxAvailable()).toBe(false);
      expect(() => seal({ a: 1 })).toThrow(/APP_SECRETS_KEY/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("derives a key from BETTER_AUTH_SECRET in production without one", () => {
    delete process.env.APP_SECRETS_KEY;
    process.env.BETTER_AUTH_SECRET = "auth-secret";
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(isSecretBoxAvailable()).toBe(true);
      const sealed = seal({ a: 1 });
      expect(open(sealed)).toEqual({ a: 1 });

      // A different auth secret derives a different key.
      process.env.BETTER_AUTH_SECRET = "rotated";
      expect(() => open(sealed)).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers APP_SECRETS_KEY over the derived key", () => {
    process.env.BETTER_AUTH_SECRET = "auth-secret";
    vi.stubEnv("NODE_ENV", "production");
    try {
      const sealed = seal({ a: 1 });
      delete process.env.APP_SECRETS_KEY;
      expect(() => open(sealed)).toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("rejects a key that is not 32 bytes", () => {
    process.env.APP_SECRETS_KEY = Buffer.from("short").toString("base64");
    expect(() => seal({ a: 1 })).toThrow(/APP_SECRETS_KEY/);
  });
});
