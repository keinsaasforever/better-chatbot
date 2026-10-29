import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMBER_MONTHLY_CAP_MICROS,
  defaultMemberCapMicros,
  isPersonalOrgMetadata,
  microsToEuroString,
} from "./member-cap";

describe("member-cap defaults", () => {
  it("defaults a team member to €15/month", () => {
    expect(
      defaultMemberCapMicros({ role: "member", orgIsPersonal: false }),
    ).toBe(DEFAULT_MEMBER_MONTHLY_CAP_MICROS);
    expect(DEFAULT_MEMBER_MONTHLY_CAP_MICROS).toBe(15_000_000);
  });

  it("leaves org owners uncapped", () => {
    expect(
      defaultMemberCapMicros({ role: "owner", orgIsPersonal: false }),
    ).toBeNull();
  });

  it("also caps invited admins by default", () => {
    expect(
      defaultMemberCapMicros({ role: "admin", orgIsPersonal: false }),
    ).toBe(DEFAULT_MEMBER_MONTHLY_CAP_MICROS);
  });

  it("never caps members of a personal workspace", () => {
    expect(
      defaultMemberCapMicros({ role: "member", orgIsPersonal: true }),
    ).toBeNull();
    expect(
      defaultMemberCapMicros({ role: "owner", orgIsPersonal: true }),
    ).toBeNull();
  });
});

describe("isPersonalOrgMetadata", () => {
  it("detects the personal flag", () => {
    expect(isPersonalOrgMetadata(JSON.stringify({ personal: true }))).toBe(
      true,
    );
  });

  it("returns false for team orgs, null, and malformed metadata", () => {
    expect(isPersonalOrgMetadata(JSON.stringify({ personal: false }))).toBe(
      false,
    );
    expect(isPersonalOrgMetadata(null)).toBe(false);
    expect(isPersonalOrgMetadata(undefined)).toBe(false);
    expect(isPersonalOrgMetadata("not json")).toBe(false);
  });
});

describe("microsToEuroString", () => {
  it("formats micros as a 2-decimal euro amount", () => {
    expect(microsToEuroString(15_000_000)).toBe("15.00");
    expect(microsToEuroString(1_234_500)).toBe("1.23");
    expect(microsToEuroString(0)).toBe("0.00");
  });
});
