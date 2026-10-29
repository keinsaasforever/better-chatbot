import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reap: vi.fn() }));

vi.mock("lib/e2b/reap-sandboxes", () => ({ reapSandboxes: mocks.reap }));

vi.mock("logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { POST } from "./route";

function request(secret?: string) {
  return new Request("http://localhost/api/sandbox/reaper", {
    method: "POST",
    headers: secret ? { "X-Scheduled-Task-Auth": secret } : {},
  });
}

describe("POST /api/sandbox/reaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SCHEDULED_TASK_SECRET = "cron-secret";
    process.env.E2B_API_KEY = "e2b_test";
    mocks.reap.mockResolvedValue({
      scanned: 2,
      paused: 1,
      killed: 0,
      failed: 0,
    });
  });

  test("runs the sweep for a caller with the right secret", async () => {
    const res = await POST(request("cron-secret"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ paused: 1 });
    expect(mocks.reap).toHaveBeenCalledOnce();
  });

  test("401s without the secret, and does not sweep", async () => {
    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mocks.reap).not.toHaveBeenCalled();
  });

  test("401s on a wrong secret of the same length", async () => {
    // Same length so the comparison exercises timingSafeEqual rather than the
    // length short-circuit.
    const res = await POST(request("cron-secrxt"));

    expect(res.status).toBe(401);
    expect(mocks.reap).not.toHaveBeenCalled();
  });

  test("503s when the secret is not configured at all", async () => {
    process.env.SCHEDULED_TASK_SECRET = undefined;
    delete process.env.SCHEDULED_TASK_SECRET;

    const res = await POST(request("cron-secret"));

    expect(res.status).toBe(503);
    expect(mocks.reap).not.toHaveBeenCalled();
  });
});
