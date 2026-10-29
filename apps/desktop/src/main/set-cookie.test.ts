import { describe, expect, it } from "vitest";
import { parseSetCookie } from "./set-cookie.js";

describe("parseSetCookie", () => {
  it("parses the Better Auth session cookie", () => {
    const parsed = parseSetCookie(
      "__Secure-better-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax",
    );
    expect(parsed).toMatchObject({
      name: "__Secure-better-auth.session_token",
      value: "abc.def",
      path: "/",
      secure: true,
      httpOnly: true,
    });
    expect(parsed?.expirationDate).toBeGreaterThan(Date.now() / 1000);
  });

  it("falls back to Expires when there is no Max-Age", () => {
    const parsed = parseSetCookie(
      "a=b; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/",
    );
    expect(parsed?.expirationDate).toBe(
      Math.floor(Date.parse("Wed, 21 Oct 2026 07:28:00 GMT") / 1000),
    );
    expect(parsed?.secure).toBe(false);
  });

  it("returns null for a header without a name", () => {
    expect(parseSetCookie("")).toBeNull();
    expect(parseSetCookie("=value; Path=/")).toBeNull();
    expect(parseSetCookie("novalue")).toBeNull();
  });
});
