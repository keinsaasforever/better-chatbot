import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("lib/db/pg/db.pg", () => ({ pgDb: {} }));
vi.mock("lib/cache", () => ({
  serverCache: { get: vi.fn(), set: vi.fn() },
}));

import { resolveBillingCustomer } from "./billing-customer";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

describe("resolveBillingCustomer", () => {
  test("bills the user when there is no organization at all", () => {
    expect(resolveBillingCustomer({ userId: USER })).toEqual({
      customerId: USER,
    });
    expect(
      resolveBillingCustomer({ userId: USER, organizationId: null }),
    ).toEqual({ customerId: USER });
  });

  // The case the three drifted copies got wrong: a personal workspace created
  // since the flag landed has a random id and is only identifiable by metadata.
  test("bills the user for a personal workspace flagged in metadata", () => {
    expect(
      resolveBillingCustomer({
        userId: USER,
        organizationId: ORG,
        organizationMetadata: JSON.stringify({ personal: true }),
      }),
    ).toEqual({ customerId: USER });
  });

  test("bills the user for a legacy personal- workspace", () => {
    expect(
      resolveBillingCustomer({
        userId: USER,
        organizationId: "personal-abc",
      }),
    ).toEqual({ customerId: USER });
  });

  test("legacy prefix wins even when metadata is absent or unparseable", () => {
    expect(
      resolveBillingCustomer({
        userId: USER,
        organizationId: "personal-abc",
        organizationMetadata: "not json",
      }),
    ).toEqual({ customerId: USER });
  });

  test("bills the organization, with the member as entity, for a team org", () => {
    expect(
      resolveBillingCustomer({
        userId: USER,
        organizationId: ORG,
        organizationMetadata: JSON.stringify({ personal: false }),
      }),
    ).toEqual({ customerId: ORG, entityId: USER });
  });

  // Failure mode: anything we cannot read as a personal flag must fall to the
  // organization, never silently to the user — moving someone's billing on a
  // malformed row would be worse than treating them as a team.
  test.each([
    ["absent", undefined],
    ["null", null],
    ["malformed", "not json"],
    ["empty", ""],
    ["an unrelated shape", JSON.stringify({ something: "else" })],
  ])("treats %s metadata as a team organization", (_label, metadata) => {
    expect(
      resolveBillingCustomer({
        userId: USER,
        organizationId: ORG,
        organizationMetadata: metadata as string | null | undefined,
      }),
    ).toEqual({ customerId: ORG, entityId: USER });
  });

  test("never returns an entity when the customer is the user", () => {
    const personal = resolveBillingCustomer({
      userId: USER,
      organizationId: ORG,
      organizationMetadata: JSON.stringify({ personal: true }),
    });
    expect(personal.entityId).toBeUndefined();
  });
});
