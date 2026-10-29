import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getInfo: vi.fn(),
  connect: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  findOwner: vi.fn(),
}));

vi.mock("lib/db/pg/repositories/sandbox-session-repository.pg", () => ({
  pgSandboxSessionRepository: { findOwner: mocks.findOwner },
}));

vi.mock("@e2b/code-interpreter", () => ({
  Sandbox: { getInfo: mocks.getInfo, connect: mocks.connect },
}));

vi.mock("lib/cache", () => ({
  serverCache: { get: mocks.cacheGet, set: mocks.cacheSet, delete: vi.fn() },
}));

vi.mock("lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { getSandboxOwnerId, isSandboxOwner } from "./sandbox-ownership";

describe("sandbox ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheGet.mockResolvedValue(undefined);
    mocks.cacheSet.mockResolvedValue(undefined);
    // Default to "not in the registry" so the existing cases exercise the E2B
    // metadata fallback; the registry path is covered explicitly below.
    mocks.findOwner.mockResolvedValue(undefined);
  });

  test("prefers the registry over a round-trip to E2B", async () => {
    mocks.findOwner.mockResolvedValue({
      userId: "user_123",
      template: "nextjs-developer",
    });

    expect(await isSandboxOwner("sbx_1", "user_123")).toBe(true);
    expect(mocks.getInfo).not.toHaveBeenCalled();
  });

  test("falls back to E2B metadata when the registry read fails", async () => {
    // Sandboxes created before the registry existed have no row, and a DB
    // outage must not lock their owner out of pausing them.
    mocks.findOwner.mockRejectedValue(new Error("db down"));
    mocks.getInfo.mockResolvedValue({
      metadata: { billingUserId: "user_123" },
    });

    expect(await isSandboxOwner("sbx_1", "user_123")).toBe(true);
  });

  test("reads the owner from billingUserId metadata", async () => {
    mocks.getInfo.mockResolvedValue({
      metadata: { billingUserId: "user_123" },
    });

    await expect(getSandboxOwnerId("sbx_1")).resolves.toBe("user_123");
    expect(await isSandboxOwner("sbx_1", "user_123")).toBe(true);
  });

  test("never resolves ownership by connecting to the sandbox", async () => {
    // Sandbox.connect auto-resumes a paused sandbox, which would bill compute
    // purely to authorize pausing it. This is the regression that costs money.
    mocks.getInfo.mockResolvedValue({
      metadata: { billingUserId: "user_123" },
    });

    await isSandboxOwner("sbx_1", "user_123");

    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.getInfo).toHaveBeenCalledWith("sbx_1", expect.anything());
  });

  test("refuses a caller who does not own the sandbox", async () => {
    mocks.getInfo.mockResolvedValue({
      metadata: { billingUserId: "user_owner" },
    });

    expect(await isSandboxOwner("sbx_1", "user_intruder")).toBe(false);
  });

  test("fails closed when the sandbox has no owner metadata", async () => {
    mocks.getInfo.mockResolvedValue({ metadata: {} });

    await expect(getSandboxOwnerId("sbx_1")).resolves.toBeNull();
    expect(await isSandboxOwner("sbx_1", "user_123")).toBe(false);
  });

  test("fails closed when the E2B API errors", async () => {
    mocks.getInfo.mockRejectedValue(new Error("not found"));

    expect(await isSandboxOwner("sbx_1", "user_123")).toBe(false);
  });

  test("serves a cached owner without calling E2B again", async () => {
    mocks.cacheGet.mockResolvedValue("user_123");

    expect(await isSandboxOwner("sbx_1", "user_123")).toBe(true);
    expect(mocks.getInfo).not.toHaveBeenCalled();
  });

  test("caches a miss briefly and distinctly from a hit", async () => {
    mocks.getInfo.mockResolvedValue({ metadata: {} });

    await getSandboxOwnerId("sbx_1");

    const [, value, ttl] = mocks.cacheSet.mock.calls[0];
    expect(value).toBe("__none__");
    expect(ttl).toBeLessThan(60_000);
  });

  test("a cached miss still refuses rather than granting access", async () => {
    mocks.cacheGet.mockResolvedValue("__none__");

    expect(await isSandboxOwner("sbx_1", "user_123")).toBe(false);
    expect(mocks.getInfo).not.toHaveBeenCalled();
  });
});
