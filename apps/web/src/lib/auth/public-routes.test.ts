import { describe, expect, it } from "vitest";
import { isPublicAuthPath, signInRedirectPath } from "./public-routes";

describe("isPublicAuthPath", () => {
  it("allows every public auth page, including the email sign-up step", () => {
    for (const path of [
      "/sign-in",
      "/sign-up",
      "/sign-up/email",
      "/forgot-password",
      "/reset-password",
    ]) {
      expect(isPublicAuthPath(path)).toBe(true);
    }
  });

  it("does not allow protected pages", () => {
    expect(isPublicAuthPath("/")).toBe(false);
    expect(isPublicAuthPath("/agents")).toBe(false);
    expect(isPublicAuthPath("/accept-invitation/abc")).toBe(false);
  });
});

describe("signInRedirectPath", () => {
  it("preserves an invitation link as the callback url", () => {
    expect(signInRedirectPath("/accept-invitation/inv-123")).toBe(
      "/sign-in?callbackUrl=%2Faccept-invitation%2Finv-123",
    );
  });

  it("keeps the query string of the requested page", () => {
    expect(signInRedirectPath("/chat", "?id=1")).toBe(
      "/sign-in?callbackUrl=%2Fchat%3Fid%3D1",
    );
  });

  it("sends api requests to a plain sign-in", () => {
    expect(signInRedirectPath("/api/user/details")).toBe("/sign-in");
  });

  it("omits a pointless callback for the root path", () => {
    expect(signInRedirectPath("/")).toBe("/sign-in");
  });

  it("drops protocol-relative paths that would leave the app", () => {
    expect(signInRedirectPath("//evil.example.com")).toBe("/sign-in");
  });
});
