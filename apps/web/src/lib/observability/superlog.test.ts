import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSuperlog = async () => {
  vi.resetModules();
  return await import("./superlog");
};

describe("isSuperlogConfigured", () => {
  const originalToken = process.env.SUPERLOG_PUBLIC_TOKEN;

  beforeEach(() => {
    delete process.env.SUPERLOG_PUBLIC_TOKEN;
  });

  afterEach(() => {
    if (originalToken === undefined) {
      delete process.env.SUPERLOG_PUBLIC_TOKEN;
    } else {
      process.env.SUPERLOG_PUBLIC_TOKEN = originalToken;
    }
  });

  it("is off when no token is set, so nothing is exported by default", async () => {
    const { isSuperlogConfigured } = await loadSuperlog();

    expect(isSuperlogConfigured()).toBe(false);
  });

  it.each(["sl_public_", "superlog_live_"])(
    "accepts the %s token format",
    async (prefix) => {
      process.env.SUPERLOG_PUBLIC_TOKEN = `${prefix}abc123`;
      const { isSuperlogConfigured } = await loadSuperlog();

      expect(isSuperlogConfigured()).toBe(true);
    },
  );

  it("rejects a token in neither known format", async () => {
    // A pasted account/admin token or a half-copied string would 401 on every
    // export — treat it as absent instead of shipping the failure to prod.
    process.env.SUPERLOG_PUBLIC_TOKEN = "some-other-secret";
    const { isSuperlogConfigured } = await loadSuperlog();

    expect(isSuperlogConfigured()).toBe(false);
  });

  it("ignores surrounding whitespace from a copy-pasted env value", async () => {
    process.env.SUPERLOG_PUBLIC_TOKEN = "  sl_public_abc123  ";
    const { isSuperlogConfigured, SUPERLOG_PUBLIC_TOKEN } =
      await loadSuperlog();

    expect(isSuperlogConfigured()).toBe(true);
    expect(SUPERLOG_PUBLIC_TOKEN).toBe("sl_public_abc123");
  });

  it("sends the token as x-api-key, the only header ingest reads", async () => {
    process.env.SUPERLOG_PUBLIC_TOKEN = "sl_public_abc123";
    const { superlogHeaders, superlogSignalUrl } = await loadSuperlog();

    expect(superlogHeaders()).toEqual({ "x-api-key": "sl_public_abc123" });
    expect(superlogSignalUrl("traces")).toBe(
      "https://intake.superlog.sh/v1/traces",
    );
  });
});
