import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  createNavigatorApiKey: vi.fn(),
  listNavigatorApiKeys: vi.fn(),
  revokeNavigatorApiKey: vi.fn(),
  isUserMemberOfOrganization: vi.fn(),
}));

vi.mock("auth/server", () => ({ getSession: mocks.getSession }));
vi.mock("lib/navigator-tools/api-keys", () => ({
  createNavigatorApiKey: mocks.createNavigatorApiKey,
  listNavigatorApiKeys: mocks.listNavigatorApiKeys,
  revokeNavigatorApiKey: mocks.revokeNavigatorApiKey,
}));
vi.mock("lib/organization/members", () => ({
  isUserMemberOfOrganization: mocks.isUserMemberOfOrganization,
}));

const { DELETE, GET, POST } = await import("./route");

const url = "http://localhost/api/cockpit/api-keys";
const post = (body: unknown) =>
  POST(
    new NextRequest(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("/api/cockpit/api-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    });
    mocks.isUserMemberOfOrganization.mockResolvedValue(true);
  });

  it("requires a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    const response = await GET(new NextRequest(url));
    expect(response.status).toBe(401);
    expect(mocks.listNavigatorApiKeys).not.toHaveBeenCalled();
  });

  it("lists only the caller's keys", async () => {
    mocks.listNavigatorApiKeys.mockResolvedValue([{ id: "k1" }]);
    const response = await GET(new NextRequest(url));
    expect(mocks.listNavigatorApiKeys).toHaveBeenCalledWith("user-1");
    expect(await response.json()).toEqual({ keys: [{ id: "k1" }] });
  });

  it("mints a key scoped to the active organization and returns it once", async () => {
    mocks.createNavigatorApiKey.mockResolvedValue({ id: "k1", key: "nav_x" });
    const response = await post({ name: "Claude Desktop" });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createNavigatorApiKey).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
      name: "Claude Desktop",
      expiresInDays: undefined,
    });
    expect(await response.json()).toEqual({ key: { id: "k1", key: "nav_x" } });
  });

  it("refuses to scope a key to an organization the caller left", async () => {
    mocks.isUserMemberOfOrganization.mockResolvedValue(false);
    const response = await post({ name: "Cursor" });
    expect(response.status).toBe(403);
    expect(mocks.createNavigatorApiKey).not.toHaveBeenCalled();
  });

  it("rejects an invalid request without creating anything", async () => {
    const response = await post({ name: "", expiresInDays: 9999 });
    expect(response.status).toBe(400);
    expect(mocks.createNavigatorApiKey).not.toHaveBeenCalled();
  });

  it("never returns internals from a failure", async () => {
    mocks.createNavigatorApiKey.mockRejectedValue(
      new Error("duplicate key value violates unique constraint"),
    );
    const response = await post({ name: "Cursor" });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to create API key",
    });
  });

  it("revokes only the caller's own key", async () => {
    mocks.revokeNavigatorApiKey.mockResolvedValue(false);
    const id = "11111111-1111-4111-8111-111111111111";
    const response = await DELETE(
      new NextRequest(`${url}?id=${id}`, { method: "DELETE" }),
    );
    expect(mocks.revokeNavigatorApiKey).toHaveBeenCalledWith("user-1", id);
    expect(response.status).toBe(404);

    const invalid = await DELETE(
      new NextRequest(`${url}?id=not-a-uuid`, { method: "DELETE" }),
    );
    expect(invalid.status).toBe(400);
  });
});
