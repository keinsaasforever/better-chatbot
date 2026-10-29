import { describe, expect, it } from "vitest";
import {
  PENDING_SIGN_IN_TTL_MS,
  createPendingSignIn,
  matchPendingSignIn,
  parsePendingSignIn,
  sanitizeReturnTo,
} from "./pending-sign-in.js";

const NOW = 1_700_000_000_000;

describe("createPendingSignIn", () => {
  it("issues a 32-character base64url state with a ten-minute expiry", () => {
    const pending = createPendingSignIn({ page: "sign-in", now: NOW });
    expect(pending.state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(pending.createdAt).toBe(NOW);
    expect(pending.expiresAt).toBe(NOW + PENDING_SIGN_IN_TTL_MS);
    expect(pending.page).toBe("sign-in");
    expect(pending.returnTo).toBe("/");
  });

  it("issues a fresh state every time", () => {
    const a = createPendingSignIn({ page: "sign-in" });
    const b = createPendingSignIn({ page: "sign-in" });
    expect(a.state).not.toBe(b.state);
  });

  it("keeps an in-app return path and drops anything else", () => {
    expect(
      createPendingSignIn({ page: "sign-up", returnTo: "/accept-invitation/x" })
        .returnTo,
    ).toBe("/accept-invitation/x");
    expect(
      createPendingSignIn({ page: "sign-up", returnTo: "//evil.com" }).returnTo,
    ).toBe("/");
    expect(
      createPendingSignIn({ page: "sign-up", returnTo: "https://evil.com" })
        .returnTo,
    ).toBe("/");
  });
});

describe("sanitizeReturnTo", () => {
  it("mirrors the web app's callbackUrl rules", () => {
    expect(sanitizeReturnTo("/chat/1")).toBe("/chat/1");
    expect(sanitizeReturnTo("/\\evil.com")).toBe("/");
    expect(sanitizeReturnTo("")).toBe("/");
    expect(sanitizeReturnTo(undefined)).toBe("/");
    expect(sanitizeReturnTo(42)).toBe("/");
  });
});

describe("matchPendingSignIn", () => {
  const pending = createPendingSignIn({
    page: "sign-in",
    now: NOW,
    randomState: () => "s".repeat(32),
  });

  it("accepts the matching state while it is still fresh", () => {
    expect(matchPendingSignIn(pending, "s".repeat(32), NOW + 1000)).toBe("ok");
  });

  it("reports nothing pending", () => {
    expect(matchPendingSignIn(null, "s".repeat(32), NOW)).toBe("none");
    expect(matchPendingSignIn(undefined, "s".repeat(32), NOW)).toBe("none");
  });

  it("reports an expired sign-in", () => {
    expect(
      matchPendingSignIn(
        pending,
        "s".repeat(32),
        NOW + PENDING_SIGN_IN_TTL_MS + 1,
      ),
    ).toBe("expired");
  });

  it("reports a foreign state, including one of a different length", () => {
    expect(matchPendingSignIn(pending, "x".repeat(32), NOW)).toBe("mismatch");
    expect(matchPendingSignIn(pending, "s".repeat(33), NOW)).toBe("mismatch");
    expect(matchPendingSignIn(pending, "", NOW)).toBe("mismatch");
  });
});

describe("parsePendingSignIn", () => {
  it("round-trips what createPendingSignIn wrote", () => {
    const pending = createPendingSignIn({
      page: "sign-up",
      now: NOW,
      returnTo: "/billing",
    });
    expect(parsePendingSignIn(JSON.stringify(pending))).toEqual(pending);
  });

  it("treats a missing, corrupt or foreign file as nothing pending", () => {
    expect(parsePendingSignIn(null)).toBeNull();
    expect(parsePendingSignIn("")).toBeNull();
    expect(parsePendingSignIn("{not json")).toBeNull();
    expect(parsePendingSignIn("[]")).toBeNull();
    expect(parsePendingSignIn(JSON.stringify({ state: "" }))).toBeNull();
    expect(
      parsePendingSignIn(
        JSON.stringify({ state: "s", createdAt: 1, expiresAt: 2, page: "x" }),
      ),
    ).toBeNull();
  });

  it("re-sanitises the return path read from disk", () => {
    expect(
      parsePendingSignIn(
        JSON.stringify({
          state: "s".repeat(32),
          createdAt: NOW,
          expiresAt: NOW + 1,
          page: "sign-in",
          returnTo: "//evil.com",
        }),
      )?.returnTo,
    ).toBe("/");
  });
});
