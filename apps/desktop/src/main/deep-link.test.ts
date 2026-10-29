import { describe, expect, it } from "vitest";
import {
  buildBrowserSignInUrl,
  findDeepLinkArg,
  isDesktopSignInPage,
  isValidDesktopState,
  parseAuthDeepLink,
} from "./deep-link.js";

const STATE = "a".repeat(32);
const TOKEN = "t".repeat(32);
const LINK = `keinsaas://auth/callback?token=${TOKEN}&state=${STATE}`;

describe("parseAuthDeepLink", () => {
  it("parses a well-formed handoff link", () => {
    expect(parseAuthDeepLink(LINK)).toEqual({ token: TOKEN, state: STATE });
  });

  it("tolerates the trailing slash Windows sometimes adds", () => {
    expect(
      parseAuthDeepLink(
        `keinsaas://auth/callback/?token=${TOKEN}&state=${STATE}`,
      ),
    ).toEqual({ token: TOKEN, state: STATE });
  });

  it("rejects other schemes, hosts and paths", () => {
    expect(
      parseAuthDeepLink(
        `https://app.keinsaas.com/callback?token=${TOKEN}&state=${STATE}`,
      ),
    ).toBeNull();
    expect(
      parseAuthDeepLink(
        `keinsaas://other/callback?token=${TOKEN}&state=${STATE}`,
      ),
    ).toBeNull();
    expect(
      parseAuthDeepLink(`keinsaas://auth/open?token=${TOKEN}&state=${STATE}`),
    ).toBeNull();
  });

  it("rejects a missing or malformed token or state", () => {
    expect(parseAuthDeepLink(`keinsaas://auth/callback?state=${STATE}`)).toBe(
      null,
    );
    expect(parseAuthDeepLink(`keinsaas://auth/callback?token=${TOKEN}`)).toBe(
      null,
    );
    expect(
      parseAuthDeepLink(`keinsaas://auth/callback?token=short&state=${STATE}`),
    ).toBeNull();
    expect(
      parseAuthDeepLink(
        `keinsaas://auth/callback?token=${TOKEN}&state=${"a".repeat(31)}`,
      ),
    ).toBeNull();
    expect(
      parseAuthDeepLink(
        `keinsaas://auth/callback?token=${TOKEN}&state=${"a".repeat(30)}%2F%2F`,
      ),
    ).toBeNull();
  });

  it("returns null instead of throwing on garbage", () => {
    expect(() => parseAuthDeepLink("not a url")).not.toThrow();
    expect(parseAuthDeepLink("not a url")).toBeNull();
    expect(parseAuthDeepLink("")).toBeNull();
  });
});

describe("findDeepLinkArg", () => {
  it("finds the protocol launch among other arguments", () => {
    expect(
      findDeepLinkArg(["C:\\Program Files\\app.exe", "--flag", LINK]),
    ).toBe(LINK);
  });

  it("returns undefined when no deep link was passed", () => {
    expect(findDeepLinkArg(["/usr/bin/app", "--flag"])).toBeUndefined();
    expect(findDeepLinkArg([])).toBeUndefined();
  });

  it("ignores links for other schemes", () => {
    expect(
      findDeepLinkArg(["app", "https://app.keinsaas.com/"]),
    ).toBeUndefined();
  });
});

describe("buildBrowserSignInUrl", () => {
  it("opens the sign-in page with the handoff route as callbackUrl", () => {
    expect(
      buildBrowserSignInUrl({
        webUrl: "https://app.keinsaas.com",
        page: "sign-in",
        state: STATE,
      }),
    ).toBe(
      `https://app.keinsaas.com/sign-in?callbackUrl=%2Fdesktop%2Fauth%2Fcomplete%3Fstate%3D${STATE}`,
    );
  });

  it("supports the sign-up page and a localhost dev origin", () => {
    expect(
      buildBrowserSignInUrl({
        webUrl: "http://localhost:3000/some/path",
        page: "sign-up",
        state: STATE,
      }),
    ).toBe(
      `http://localhost:3000/sign-up?callbackUrl=%2Fdesktop%2Fauth%2Fcomplete%3Fstate%3D${STATE}`,
    );
  });
});

describe("validators", () => {
  it("accepts only the two auth pages", () => {
    expect(isDesktopSignInPage("sign-in")).toBe(true);
    expect(isDesktopSignInPage("sign-up")).toBe(true);
    expect(isDesktopSignInPage("admin")).toBe(false);
    expect(isDesktopSignInPage(undefined)).toBe(false);
  });

  it("accepts only base64url states of the expected length", () => {
    expect(isValidDesktopState(STATE)).toBe(true);
    expect(isValidDesktopState("a".repeat(64))).toBe(true);
    expect(isValidDesktopState("a".repeat(65))).toBe(false);
    expect(isValidDesktopState("a".repeat(31))).toBe(false);
    expect(isValidDesktopState(`${"a".repeat(31)}=`)).toBe(false);
    expect(isValidDesktopState(42)).toBe(false);
  });
});
