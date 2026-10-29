import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as null | {
    user: { id: string };
    session: { activeOrganizationId: string | null };
  },
  canManage: true,
  list: vi.fn(),
  describe: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock("auth/route-guard", () => ({
  withAuth:
    (handler: (request: Request, session: unknown) => Promise<Response>) =>
    (request: Request) =>
      mocks.session
        ? handler(request, mocks.session)
        : Promise.resolve(
            Response.json({ error: "Unauthorized" }, { status: 401 }),
          ),
}));

vi.mock("lib/cockpit/connections", () => ({
  resolveCockpitAccess: async (scope: object) => ({
    ...scope,
    canManage: mocks.canManage,
  }),
  listConnectionViews: mocks.list,
  describeScopes: mocks.describe,
  saveConnection: mocks.save,
  removeConnection: mocks.remove,
}));

vi.mock("lib/crypto/secret-box", () => ({ isSecretBoxAvailable: () => true }));

const { GET, POST, DELETE } = await import("./route");

const post = (body: unknown) =>
  POST(
    new Request("http://test/api/cockpit/connections", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
  );

describe("/api/cockpit/connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
    };
    mocks.canManage = true;
    mocks.describe.mockResolvedValue({ workspace: "Acme", elsewhere: [] });
  });

  it("returns 401 without a session", async () => {
    mocks.session = null;
    const res = await GET(new Request("http://test") as never);
    expect(res.status).toBe(401);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("lists the scope's connections without decrypted secrets", async () => {
    mocks.list.mockResolvedValue([
      {
        id: "c1",
        provider: "stripe",
        config: { values: {}, secretsSet: ["restrictedKey"] },
      },
    ]);
    const res = await GET(new Request("http://test") as never);
    const body = await res.json();
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", organizationId: "org-1" }),
    );
    expect(body.connections[0].config.secretsSet).toEqual(["restrictedKey"]);
    expect(JSON.stringify(body)).not.toContain("rk_");
  });

  it("points at connections saved under another workspace", async () => {
    mocks.list.mockResolvedValue([]);
    mocks.describe.mockResolvedValue({
      workspace: "Personal",
      elsewhere: [{ workspace: "Keinsaas", count: 3 }],
    });
    const res = await GET(new Request("http://test") as never);
    const body = await res.json();
    expect(body.scope).toEqual({
      workspace: "Personal",
      elsewhere: [{ workspace: "Keinsaas", count: 3 }],
    });
  });

  it("still lists connections when the scope summary fails", async () => {
    mocks.list.mockResolvedValue([
      { id: "c1", provider: "stripe", config: { values: {}, secretsSet: [] } },
    ]);
    mocks.describe.mockRejectedValue(new Error("db down"));
    const res = await GET(new Request("http://test") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toHaveLength(1);
    expect(body.scope).toBeNull();
  });

  it("refuses to save for a member who cannot manage the org", async () => {
    mocks.canManage = false;
    const res = await post({
      provider: "stripe",
      config: { restrictedKey: "rk_test_1" },
    });
    expect(res.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects an unknown provider", async () => {
    const res = await post({ provider: "paypal", config: {} });
    expect(res.status).toBe(400);
  });

  it("passes a validation failure through as a reason code", async () => {
    mocks.save.mockResolvedValue({
      ok: false,
      status: 400,
      reason: "invalidConfig",
      issues: ["restrictedKey"],
    });
    const res = await post({
      provider: "stripe",
      config: { restrictedKey: "x" },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      reason: "invalidConfig",
      issues: ["restrictedKey"],
    });
  });

  it("answers a 500 with a generic body", async () => {
    mocks.save.mockRejectedValue(new Error("db password is hunter2"));
    const res = await post({
      provider: "stripe",
      config: { restrictedKey: "rk_test_1" },
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
  });

  it("deletes only with a valid id", async () => {
    const bad = await DELETE(new Request("http://test?id=nope") as never);
    expect(bad.status).toBe(400);
    mocks.remove.mockResolvedValue(true);
    const ok = await DELETE(
      new Request(
        "http://test?id=6f1c1f43-2b4e-4d0e-9a3a-6b1e2d3c4f5a",
      ) as never,
    );
    expect(ok.status).toBe(200);
  });
});
