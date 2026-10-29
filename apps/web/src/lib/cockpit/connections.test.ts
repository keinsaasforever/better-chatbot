import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  scopeCounts: [] as Array<Record<string, any>>,
  orgName: "Acme",
}));

// describeScopes reads the active workspace's name through this chain.
vi.mock("lib/db/pg/db.pg", () => ({
  pgDb: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ name: store.orgName }] }),
      }),
    }),
  },
}));
vi.mock("lib/db/repository", () => ({
  cockpitConnectionRepository: {
    listForScope: async () => store.rows,
    countScopesForUser: async () => store.scopeCounts,
    findForScope: async (_u: string, _o: string | null, provider: string) =>
      store.rows.find((r) => r.provider === provider) ?? null,
    findByIdForScope: async (id: string) =>
      store.rows.find((r) => r.id === id) ?? null,
    upsert: async (input: Record<string, any>) => {
      const existing = store.rows.find((r) => r.provider === input.provider);
      const row = {
        id: existing?.id ?? `id-${store.rows.length + 1}`,
        label: null,
        enabled: true,
        lastOkAt: null,
        lastError: null,
        updatedAt: new Date(),
        ...existing,
        ...input,
      };
      store.rows = [...store.rows.filter((r) => r !== existing), row];
      return row;
    },
    markResult: async (id: string, ok: boolean, error: string | null) => {
      const row = store.rows.find((r) => r.id === id);
      if (row) row.lastError = ok ? null : error;
    },
  },
}));

const probe = vi.hoisted(() => vi.fn());
vi.mock("./providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers")>()),
  probeProvider: probe,
}));

process.env.APP_SECRETS_KEY = randomBytes(32).toString("base64");

const { saveConnection, listConnectionViews, testConnection, describeScopes } =
  await import("./connections");

const scope = { userId: "user-1", organizationId: null };

describe("cockpit connections", () => {
  beforeEach(() => {
    store.rows = [];
    probe.mockReset();
    probe.mockResolvedValue({ ok: true });
  });

  it("seals the config and never returns the secret", async () => {
    const result = await saveConnection(scope, {
      provider: "stripe",
      config: { restrictedKey: "rk_test_abc123" },
    });
    expect(result.ok).toBe(true);
    expect(store.rows[0].configEncrypted).not.toContain("rk_test_abc123");
    const views = await listConnectionViews(scope);
    expect(JSON.stringify(views)).not.toContain("rk_test_abc123");
    expect(views[0].config.secretsSet).toEqual(["restrictedKey"]);
  });

  it("keeps a stored secret when the form leaves it blank", async () => {
    await saveConnection(scope, {
      provider: "superlog",
      config: { mcpUrl: "https://mcp.example.com/mcp", token: "tok-1" },
    });
    const again = await saveConnection(scope, {
      provider: "superlog",
      config: { mcpUrl: "https://mcp.example.com/v2", token: "" },
    });
    expect(again.ok).toBe(true);
    const views = await listConnectionViews(scope);
    expect(views[0].config.values).toEqual({
      mcpUrl: "https://mcp.example.com/v2",
    });
    expect(views[0].config.secretsSet).toEqual(["token"]);
  });

  it("rejects an invalid config with field names only", async () => {
    const result = await saveConnection(scope, {
      provider: "stripe",
      config: { restrictedKey: "sk_live_not_restricted" },
    });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      reason: "invalidConfig",
      issues: ["restrictedKey"],
    });
    expect(JSON.stringify(result)).not.toContain("sk_live_not_restricted");
    expect(store.rows).toHaveLength(0);
  });

  it("probes a submitted config merged over the stored secret", async () => {
    await saveConnection(scope, {
      provider: "stripe",
      config: { restrictedKey: "rk_test_stored" },
    });
    probe.mockResolvedValue({ ok: true });
    const result = await testConnection(scope, {
      provider: "stripe",
      config: { restrictedKey: "" },
    });
    expect(result.ok).toBe(true);
    // Call 0 is the probe on save; call 1 is the test.
    expect(probe.mock.calls[1][0]).toBe("stripe");
    expect(probe.mock.calls[1][1]).toEqual({ restrictedKey: "rk_test_stored" });
  });

  it("probes as the connection's owner, not as the admin testing it", async () => {
    await saveConnection(scope, {
      provider: "stripe",
      config: { restrictedKey: "rk_test_stored" },
    });
    const otherAdmin = {
      userId: "admin-2",
      organizationId: scope.organizationId,
    };
    await testConnection(otherAdmin, {
      provider: "stripe",
      config: { restrictedKey: "" },
    });
    // An MCP-server-backed feed resolves its server as this identity on
    // every refresh, so the test must not pass with someone else's access.
    expect(probe.mock.calls[1][2]).toMatchObject({
      scope: { userId: scope.userId, organizationId: scope.organizationId },
    });
  });

  it("records the probe outcome when saving", async () => {
    probe.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const result = await saveConnection(scope, {
      provider: "stripe",
      config: { restrictedKey: "rk_test_wrong" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.connection.lastError).toBe("unauthorized");
  });

  it("reports a probe failure as a reason code", async () => {
    probe.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const result = await testConnection(scope, {
      provider: "stripe",
      config: { restrictedKey: "rk_test_wrong" },
    });
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });
});

describe("describeScopes", () => {
  it("names the active workspace and lists only the other ones", async () => {
    store.orgName = "Personal";
    store.scopeCounts = [
      {
        organizationId: "org-personal",
        organizationName: "Personal",
        count: 0,
      },
      { organizationId: "org-team", organizationName: "Keinsaas", count: 3 },
      { organizationId: null, organizationName: null, count: 1 },
    ];
    expect(
      await describeScopes({
        userId: "user-1",
        organizationId: "org-personal",
      }),
    ).toEqual({
      workspace: "Personal",
      elsewhere: [
        { workspace: "Keinsaas", count: 3 },
        { workspace: null, count: 1 },
      ],
    });
  });

  it("reports nothing elsewhere when everything is in the active workspace", async () => {
    store.scopeCounts = [
      { organizationId: "org-team", organizationName: "Keinsaas", count: 3 },
    ];
    const summary = await describeScopes({
      userId: "user-1",
      organizationId: "org-team",
    });
    expect(summary.elsewhere).toEqual([]);
  });
});
