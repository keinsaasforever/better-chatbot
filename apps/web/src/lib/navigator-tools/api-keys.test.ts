import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyApiKey: vi.fn(),
  isUserMemberOfOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("lib/auth/auth-instance", () => ({
  auth: { api: { verifyApiKey: mocks.verifyApiKey } },
}));
vi.mock("lib/db/pg/db.pg", () => ({ pgDb: {} }));
vi.mock("lib/organization/members", () => ({
  isUserMemberOfOrganization: mocks.isUserMemberOfOrganization,
}));

const { verifyNavigatorApiKey } = await import("./api-keys");

const validKey = (metadata: unknown) => ({
  valid: true,
  error: null,
  key: { id: "k1", referenceId: "user-1", metadata },
});

describe("verifyNavigatorApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUserMemberOfOrganization.mockResolvedValue(true);
  });

  it("acts as the key's user in the key's organization", async () => {
    mocks.verifyApiKey.mockResolvedValue(validKey({ organizationId: "org-1" }));
    await expect(verifyNavigatorApiKey("nav_k")).resolves.toEqual({
      ok: true,
      actor: { userId: "user-1", organizationId: "org-1", source: "mcp" },
    });
    expect(mocks.isUserMemberOfOrganization).toHaveBeenCalledWith(
      "org-1",
      "user-1",
    );
  });

  it("stops working for an organization the user no longer belongs to", async () => {
    mocks.verifyApiKey.mockResolvedValue(validKey({ organizationId: "org-1" }));
    mocks.isUserMemberOfOrganization.mockResolvedValue(false);
    await expect(verifyNavigatorApiKey("nav_k")).resolves.toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("fails closed to owner-only when the key carries no organization", async () => {
    mocks.verifyApiKey.mockResolvedValue(validKey(null));
    await expect(verifyNavigatorApiKey("nav_k")).resolves.toEqual({
      ok: true,
      actor: { userId: "user-1", organizationId: null, source: "mcp" },
    });
    expect(mocks.isUserMemberOfOrganization).not.toHaveBeenCalled();
  });

  it("tells a rate-limited key from an invalid one", async () => {
    mocks.verifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: "RATE_LIMITED" },
      key: null,
    });
    await expect(verifyNavigatorApiKey("nav_k")).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
    });

    mocks.verifyApiKey.mockResolvedValue({
      valid: false,
      error: { code: "KEY_NOT_FOUND" },
      key: null,
    });
    await expect(verifyNavigatorApiKey("nav_k")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });

    mocks.verifyApiKey.mockRejectedValue(new Error("db down"));
    await expect(verifyNavigatorApiKey("nav_k")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
