import { describe, expect, it } from "vitest";
import { sanitizeCallbackUrl } from "./callback-url";
import {
  buildDesktopCallbackUrl,
  buildDesktopHandoffPath,
  isValidDesktopState,
} from "./desktop-handoff";

const STATE = "Ab3-_".padEnd(32, "x");

describe("isValidDesktopState", () => {
  it("accepts a base64url nonce of the expected length", () => {
    expect(isValidDesktopState(STATE)).toBe(true);
    expect(isValidDesktopState("a".repeat(64))).toBe(true);
  });

  it("rejects short, padded, repeated or absent values", () => {
    expect(isValidDesktopState("a".repeat(31))).toBe(false);
    expect(isValidDesktopState("a".repeat(65))).toBe(false);
    expect(isValidDesktopState(`${"a".repeat(31)}=`)).toBe(false);
    expect(isValidDesktopState("../".padEnd(32, "a"))).toBe(false);
    expect(isValidDesktopState([STATE, STATE])).toBe(false);
    expect(isValidDesktopState(undefined)).toBe(false);
    expect(isValidDesktopState(null)).toBe(false);
  });
});

describe("buildDesktopCallbackUrl", () => {
  it("encodes token and state into the keinsaas:// link", () => {
    const url = buildDesktopCallbackUrl({ token: "to ken&x", state: STATE });
    expect(url.startsWith("keinsaas://auth/callback?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("auth");
    expect(parsed.pathname).toBe("/callback");
    expect(parsed.searchParams.get("token")).toBe("to ken&x");
    expect(parsed.searchParams.get("state")).toBe(STATE);
  });
});

describe("buildDesktopHandoffPath", () => {
  it("produces a relative path that survives callbackUrl sanitising", () => {
    const path = buildDesktopHandoffPath(STATE);
    expect(path).toBe(`/desktop/auth/complete?state=${STATE}`);
    expect(sanitizeCallbackUrl(path)).toBe(path);
  });
});
