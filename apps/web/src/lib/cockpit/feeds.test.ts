import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
process.env.APP_SECRETS_KEY = randomBytes(32).toString("base64");

const repo = vi.hoisted(() => ({
  listForScope: vi.fn(),
  markResult: vi.fn(async () => {}),
}));
vi.mock("lib/db/repository", () => ({ cockpitConnectionRepository: repo }));
vi.mock("lib/db/pg/db.pg", () => ({ pgDb: {} }));
vi.mock("lib/notifications/create-notifications", () => ({
  createNotifications: vi.fn(async () => ({ inserted: [] })),
}));

const log = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock("logger", () => ({ default: log }));
vi.mock("lib/ai/mcp/ephemeral-client", () => ({
  createEphemeralMCPClient: vi.fn(),
}));

const fetchProvider = vi.hoisted(() => vi.fn());
vi.mock("./providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./providers")>()),
  fetchProvider,
}));

const { getCockpitData, mergeIncidents } = await import("./feeds");
const { seal } = await import("lib/crypto/secret-box");

const row = (provider: string, config: unknown) => ({
  id: `conn-${provider}`,
  userId: "owner-1",
  organizationId: "org-1",
  provider,
  label: null,
  configEncrypted: seal(config),
  enabled: true,
  lastOkAt: null,
  lastError: null,
  createdAt: new Date(),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
});

describe("getCockpitData", () => {
  beforeEach(() => {
    repo.listForScope.mockReset();
    repo.markResult.mockClear();
    fetchProvider.mockReset();
    log.warn.mockClear();
  });

  it("reads connections for the caller's scope and reports the rest as not connected", async () => {
    repo.listForScope.mockResolvedValue([
      row("stripe", { restrictedKey: "rk_test_1" }),
    ]);
    fetchProvider.mockResolvedValue({ status: "inop", reason: "unauthorized" });
    const data = await getCockpitData({
      userId: "u-1",
      organizationId: "org-1",
    });
    expect(repo.listForScope).toHaveBeenCalledWith("u-1", "org-1");
    expect(fetchProvider).toHaveBeenCalledTimes(1);
    expect(fetchProvider.mock.calls[0][0]).toBe("stripe");
    expect(data.stripe).toEqual({ status: "inop", reason: "unauthorized" });
    expect(data.marketing).toEqual({ status: "inop", reason: "notConnected" });
    expect(repo.markResult).toHaveBeenCalledWith(
      "conn-stripe",
      false,
      "unauthorized",
    );
    expect(data.connections.find((c) => c.provider === "stripe")).toMatchObject(
      {
        connected: true,
        lastError: "unauthorized",
      },
    );
    // The new INOP state reaches Superlog with the reason, no config.
    expect(log.warn).toHaveBeenCalledWith("[cockpit] feed inop", {
      "cockpit.provider": "stripe",
      "cockpit.reason": "unauthorized",
    });
  });

  it("does not log a feed that stays INOP for the same reason", async () => {
    repo.listForScope.mockResolvedValue([
      {
        ...row("stripe", { restrictedKey: "rk_test_1" }),
        lastError: "unauthorized",
        updatedAt: new Date("2026-10-02T00:00:00Z"),
      },
    ]);
    fetchProvider.mockResolvedValue({ status: "inop", reason: "unauthorized" });
    await getCockpitData({ userId: "u-4", organizationId: "org-4" });
    expect(log.warn).not.toHaveBeenCalled();
    expect(repo.markResult).not.toHaveBeenCalled();
  });

  it("serves the second read from the 60 s cache", async () => {
    repo.listForScope.mockResolvedValue([]);
    await getCockpitData({ userId: "u-2", organizationId: null });
    await getCockpitData({ userId: "u-2", organizationId: null });
    expect(repo.listForScope).toHaveBeenCalledTimes(2);
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  it("never throws when the connection read fails", async () => {
    repo.listForScope.mockRejectedValue(new Error("pool exhausted"));
    const data = await getCockpitData({ userId: "u-3", organizationId: null });
    expect(data.stripe).toEqual({ status: "inop", reason: "unreachable" });
  });
});

describe("mergeIncidents", () => {
  const product = (key: string, label: string) => ({
    key,
    label,
    deploy: { status: "inop" as const, reason: "x" },
    incidents: { status: "inop" as const, reason: "notConnected" },
    spend: { status: "inop" as const, reason: "x" },
    margin: { status: "inop" as const, reason: "x" },
  });
  const superlog = {
    status: "live" as const,
    updatedAt: "",
    data: {
      openIncidents: 3,
      incidents24h: 1,
      firingAlerts: 0,
      errors24h: 9,
      incidents: [],
      services: [
        { name: "keinsaas-navigator-web", openIncidents: 2, errors24h: 7 },
      ],
    },
  };

  it("matches a project to the Superlog service containing its key", () => {
    const merged = mergeIncidents(
      {
        status: "live",
        updatedAt: "",
        data: [
          product("navigator", "NAVIGATOR"),
          product("sales-agent", "SALES AGENT"),
        ],
      },
      superlog,
    );
    if (merged.status !== "live") throw new Error("expected live");
    expect(merged.data[0].incidents).toMatchObject({
      status: "live",
      data: { open: 2, errors24h: 7 },
    });
    expect(merged.data[1].incidents).toEqual({
      status: "inop",
      reason: "serviceUnmatched",
    });
  });
});
