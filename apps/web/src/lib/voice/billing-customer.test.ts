import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveBillingCustomerById: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("lib/billing/billing-customer", () => ({
  resolveBillingCustomerById: mocks.resolveBillingCustomerById,
}));

import { resolveVoiceBillingCustomerId } from "./billing-customer";

const USER = "user-1";
const ORG = "22222222-2222-4222-8222-222222222222";

describe("resolveVoiceBillingCustomerId", () => {
  beforeEach(() => mocks.resolveBillingCustomerById.mockReset());

  // Voice used to decide this itself, testing only the legacy `personal-`
  // prefix. That billed a modern personal workspace to its organization while
  // chat billed the same person to their user id — two Autumn customers for
  // one human. It must now defer, so it cannot drift again.
  test("defers to the shared resolver and returns its customer id", async () => {
    mocks.resolveBillingCustomerById.mockResolvedValue({
      customerId: ORG,
      entityId: USER,
    });

    await expect(
      resolveVoiceBillingCustomerId({ userId: USER, organizationId: ORG }),
    ).resolves.toBe(ORG);

    expect(mocks.resolveBillingCustomerById).toHaveBeenCalledWith({
      userId: USER,
      organizationId: ORG,
    });
  });

  test("returns the user id when the resolver says the workspace is personal", async () => {
    mocks.resolveBillingCustomerById.mockResolvedValue({ customerId: USER });

    await expect(
      resolveVoiceBillingCustomerId({ userId: USER, organizationId: ORG }),
    ).resolves.toBe(USER);
  });

  test("passes a null organization through rather than deciding locally", async () => {
    mocks.resolveBillingCustomerById.mockResolvedValue({ customerId: USER });

    await expect(
      resolveVoiceBillingCustomerId({ userId: USER, organizationId: null }),
    ).resolves.toBe(USER);

    expect(mocks.resolveBillingCustomerById).toHaveBeenCalledWith({
      userId: USER,
      organizationId: null,
    });
  });
});
