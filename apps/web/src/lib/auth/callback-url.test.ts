import { describe, expect, it } from "vitest";
import { callbackUrlQuery, sanitizeCallbackUrl } from "./callback-url";

describe("sanitizeCallbackUrl", () => {
  it("accepts in-app relative paths", () => {
    expect(sanitizeCallbackUrl("/accept-invitation/abc")).toBe(
      "/accept-invitation/abc",
    );
    expect(sanitizeCallbackUrl("/")).toBe("/");
  });

  it("takes the first entry of a repeated query param", () => {
    expect(sanitizeCallbackUrl(["/a", "/b"])).toBe("/a");
  });

  it("rejects open-redirect and non-relative targets", () => {
    expect(sanitizeCallbackUrl("https://evil.com")).toBeUndefined();
    expect(sanitizeCallbackUrl("//evil.com")).toBeUndefined();
    expect(sanitizeCallbackUrl("/\\evil.com")).toBeUndefined();
    expect(sanitizeCallbackUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeCallbackUrl("")).toBeUndefined();
    expect(sanitizeCallbackUrl(undefined)).toBeUndefined();
    expect(sanitizeCallbackUrl(null)).toBeUndefined();
  });
});

describe("callbackUrlQuery", () => {
  it("builds an encoded query suffix when present", () => {
    expect(callbackUrlQuery("/accept-invitation/abc")).toBe(
      "?callbackUrl=%2Faccept-invitation%2Fabc",
    );
  });

  it("returns an empty string when absent", () => {
    expect(callbackUrlQuery(undefined)).toBe("");
  });
});
