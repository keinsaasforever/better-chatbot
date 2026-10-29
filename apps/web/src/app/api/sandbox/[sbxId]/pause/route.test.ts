import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  connect: vi.fn(),
  getSession: vi.fn(),
  isOwner: vi.fn(),
  markState: vi.fn(),
}));

vi.mock("lib/db/pg/repositories/sandbox-session-repository.pg", () => ({
  pgSandboxSessionRepository: { markState: mocks.markState },
}));

vi.mock("@e2b/code-interpreter", () => ({
  Sandbox: { pause: mocks.pause, connect: mocks.connect },
}));

vi.mock("auth/server", () => ({ getSession: mocks.getSession }));

vi.mock("lib/e2b/sandbox-ownership", () => ({
  isSandboxOwner: mocks.isOwner,
}));

vi.mock("lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { POST } from "./route";

const params = Promise.resolve({ sbxId: "sbx_1" });

/** sendBeacon sends no body and no content-type — the route must cope. */
function bodylessRequest() {
  return new Request("http://localhost/api/sandbox/sbx_1/pause", {
    method: "POST",
  });
}

describe("POST /api/sandbox/[sbxId]/pause", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.E2B_API_KEY = "e2b_test";
    mocks.getSession.mockResolvedValue({ user: { id: "user_123" } });
    mocks.isOwner.mockResolvedValue(true);
    mocks.pause.mockResolvedValue(true);
    mocks.markState.mockResolvedValue(undefined);
  });

  test("records the paused state so the reaper stops considering it", async () => {
    await POST(bodylessRequest(), { params });

    expect(mocks.markState).toHaveBeenCalledWith("sbx_1", "paused");
  });

  test("pauses a sandbox the caller owns", async () => {
    const res = await POST(bodylessRequest(), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      alreadyPaused: false,
    });
    expect(mocks.pause).toHaveBeenCalledWith("sbx_1", expect.anything());
  });

  test("never connects to the sandbox — connect would resume it", async () => {
    await POST(bodylessRequest(), { params });

    expect(mocks.connect).not.toHaveBeenCalled();
  });

  test("401 without a session", async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await POST(bodylessRequest(), { params });

    expect(res.status).toBe(401);
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  test("403 for a sandbox owned by someone else, without pausing it", async () => {
    mocks.isOwner.mockResolvedValue(false);

    const res = await POST(bodylessRequest(), { params });

    expect(res.status).toBe(403);
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  test("an already-paused sandbox is a success, not an error", async () => {
    // Beacons double-fire on unload; the SDK returns false for the API's 409.
    mocks.pause.mockResolvedValue(false);

    const res = await POST(bodylessRequest(), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      alreadyPaused: true,
    });
  });
});
