import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setTimeout: vi.fn(),
  getSession: vi.fn(),
  isOwner: vi.fn(),
  touch: vi.fn(),
}));

vi.mock("lib/db/pg/repositories/sandbox-session-repository.pg", () => ({
  pgSandboxSessionRepository: { touch: mocks.touch },
}));

vi.mock("@e2b/code-interpreter", () => ({
  Sandbox: { setTimeout: mocks.setTimeout },
}));

vi.mock("auth/server", () => ({ getSession: mocks.getSession }));

vi.mock("lib/e2b/sandbox-ownership", () => ({
  isSandboxOwner: mocks.isOwner,
}));

vi.mock("lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { PREVIEW_IDLE_TIMEOUT_MS } from "lib/e2b/create-sandbox";
import { POST } from "./route";

const params = Promise.resolve({ sbxId: "sbx_1" });

function request() {
  return new Request("http://localhost/api/sandbox/sbx_1/extend", {
    method: "POST",
  });
}

describe("POST /api/sandbox/[sbxId]/extend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.E2B_API_KEY = "e2b_test";
    mocks.getSession.mockResolvedValue({ user: { id: "user_123" } });
    mocks.isOwner.mockResolvedValue(true);
    mocks.touch.mockResolvedValue(true);
    mocks.setTimeout.mockResolvedValue(undefined);
  });

  test("renews to the short idle TTL, not the setup TTL", async () => {
    const res = await POST(request(), { params });

    expect(res.status).toBe(200);
    expect(mocks.setTimeout).toHaveBeenCalledWith(
      "sbx_1",
      PREVIEW_IDLE_TIMEOUT_MS,
      expect.anything(),
    );
  });

  test("records liveness so the reaper can tell idle from abandoned", async () => {
    await POST(request(), { params });

    expect(mocks.touch).toHaveBeenCalledWith("sbx_1", "user_123");
    // The registry answered, so there is no reason to also ask E2B.
    expect(mocks.isOwner).not.toHaveBeenCalled();
  });

  test("falls back to E2B metadata for sandboxes with no registry row", async () => {
    mocks.touch.mockResolvedValue(false);
    mocks.isOwner.mockResolvedValue(true);

    const res = await POST(request(), { params });

    expect(res.status).toBe(200);
    expect(mocks.setTimeout).toHaveBeenCalledOnce();
  });

  test("401 without a session", async () => {
    mocks.getSession.mockResolvedValue(null);

    const res = await POST(request(), { params });

    expect(res.status).toBe(401);
    expect(mocks.setTimeout).not.toHaveBeenCalled();
  });

  test("403 when extending someone else's sandbox, and does not extend it", async () => {
    // Without this check any authenticated user could keep any sandbox in the
    // account alive by ID, billing compute to its actual owner.
    mocks.touch.mockResolvedValue(false);
    mocks.isOwner.mockResolvedValue(false);

    const res = await POST(request(), { params });

    expect(res.status).toBe(403);
    expect(mocks.setTimeout).not.toHaveBeenCalled();
  });
});
