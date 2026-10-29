import { describe, expect, it } from "vitest";
import { CAPTCHA_HEADER, captchaHeaders, captchaSubmitReady } from "./captcha";

describe("captchaHeaders", () => {
  it("carries the token under the header the plugin reads", () => {
    expect(captchaHeaders("tok")).toEqual({ [CAPTCHA_HEADER]: "tok" });
  });

  it("sends nothing when there is no token", () => {
    expect(captchaHeaders(null)).toEqual({});
    expect(captchaHeaders(undefined)).toEqual({});
    expect(captchaHeaders("")).toEqual({});
  });
});

describe("captchaSubmitReady", () => {
  it("never blocks when Turnstile is not configured", () => {
    expect(
      captchaSubmitReady({ configured: false, token: null, errored: false }),
    ).toBe(true);
  });

  it("blocks only while the widget is still fetching a token", () => {
    expect(
      captchaSubmitReady({ configured: true, token: null, errored: false }),
    ).toBe(false);
    expect(
      captchaSubmitReady({ configured: true, token: "tok", errored: false }),
    ).toBe(true);
  });

  it("stays ready when the widget errored, so a blocked widget is not a lockout", () => {
    expect(
      captchaSubmitReady({ configured: true, token: null, errored: true }),
    ).toBe(true);
  });
});
