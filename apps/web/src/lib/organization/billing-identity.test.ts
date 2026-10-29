import { describe, expect, test } from "vitest";
import { isPersonalOrg } from "./billing-identity";

const TEAM_ORG = {
  id: "3f0c1a2b-4d5e-6f70-8192-a3b4c5d6e7f8",
  metadata: JSON.stringify({ seats: 5 }),
};
// Personal orgs are created with crypto.randomUUID() ids, so only the metadata
// flag identifies them — this is the case every prefix-only check missed.
const PERSONAL_ORG = {
  id: "9a8b7c6d-5e4f-4031-2213-445566778899",
  metadata: JSON.stringify({ personal: true, userId: "user-1" }),
};
const LEGACY_PERSONAL_ORG = { id: "personal-user-1", metadata: null };

describe("isPersonalOrg", () => {
  test("detects a personal workspace by metadata on a uuid id", () => {
    expect(isPersonalOrg(PERSONAL_ORG)).toBe(true);
  });

  test("detects a legacy personal workspace by id prefix", () => {
    expect(isPersonalOrg(LEGACY_PERSONAL_ORG)).toBe(true);
  });

  test("treats a team org as a team org", () => {
    expect(isPersonalOrg(TEAM_ORG)).toBe(false);
  });

  // The direction that costs money: misreading a team org as personal would
  // silently move a whole workspace's spend onto one member's pool. The billing
  // rule built on this lives in lib/billing/billing-customer.ts, which asserts
  // the same failure mode against the customer it resolves.
  test("classifies an org with unparseable metadata as a team org", () => {
    expect(isPersonalOrg({ id: TEAM_ORG.id, metadata: "{not json" })).toBe(
      false,
    );
  });
});
