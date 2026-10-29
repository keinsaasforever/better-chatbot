import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  pause: vi.fn(),
  kill: vi.fn(),
  list: vi.fn(),
  listIdleRunning: vi.fn(),
  listPausedBefore: vi.fn(),
  findKnownIds: vi.fn(),
  markState: vi.fn(),
}));

vi.mock("@e2b/code-interpreter", () => ({
  Sandbox: { pause: mocks.pause, kill: mocks.kill, list: mocks.list },
}));

vi.mock("lib/db/pg/repositories/sandbox-session-repository.pg", () => ({
  pgSandboxSessionRepository: {
    listIdleRunning: mocks.listIdleRunning,
    listPausedBefore: mocks.listPausedBefore,
    findKnownIds: mocks.findKnownIds,
    markState: mocks.markState,
  },
}));

vi.mock("lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { reapSandboxes } from "./reap-sandboxes";

/**
 * Sandbox.list returns a paginator, not an array: `hasNext` is a getter and
 * each `nextItems()` fetches one page. Code that awaits it and calls `.filter`
 * silently sees nothing; code that reads one page silently sees only the first
 * 100 sandboxes. This fake models the real contract so those bugs fail here.
 */
function paginator(pages: Array<Array<Record<string, unknown>>>) {
  let index = 0;
  return {
    get hasNext() {
      return index < pages.length;
    },
    nextItems: async () => pages[index++],
  };
}

function emptyPaginator() {
  return paginator([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.E2B_API_KEY = "e2b_test";
  mocks.listIdleRunning.mockResolvedValue([]);
  mocks.listPausedBefore.mockResolvedValue([]);
  mocks.findKnownIds.mockResolvedValue(new Set<string>());
  mocks.markState.mockResolvedValue(undefined);
  mocks.pause.mockResolvedValue(true);
  mocks.kill.mockResolvedValue(true);
  mocks.list.mockReturnValue(emptyPaginator());
});

describe("reapSandboxes", () => {
  test("pauses a tracked sandbox nobody has touched", async () => {
    mocks.listIdleRunning.mockResolvedValue([{ sandboxId: "sbx_idle" }]);

    const result = await reapSandboxes();

    expect(mocks.pause).toHaveBeenCalledWith("sbx_idle", expect.anything());
    expect(mocks.markState).toHaveBeenCalledWith("sbx_idle", "paused");
    expect(result.paused).toBe(1);
  });

  test("pauses rather than kills, so the user's work survives", async () => {
    mocks.listIdleRunning.mockResolvedValue([{ sandboxId: "sbx_idle" }]);

    await reapSandboxes();

    expect(mocks.kill).not.toHaveBeenCalled();
  });

  test("drains every page of the orphan paginator", async () => {
    // The single most likely bug in this sweep: reading only the first page
    // and reporting a clean run while orphans keep billing.
    mocks.list.mockReturnValue(
      paginator([
        [{ sandboxId: "sbx_a", metadata: { template: "nextjs-developer" } }],
        [{ sandboxId: "sbx_b", metadata: { template: "vue-developer" } }],
      ]),
    );

    await reapSandboxes();

    const paused = mocks.pause.mock.calls.map((call) => call[0]);
    expect(paused).toContain("sbx_a");
    expect(paused).toContain("sbx_b");
  });

  test("leaves sandboxes the registry already tracks to the DB pass", async () => {
    mocks.list.mockReturnValue(
      paginator([
        [
          {
            sandboxId: "sbx_known",
            metadata: { template: "nextjs-developer" },
          },
        ],
      ]),
    );
    mocks.findKnownIds.mockResolvedValue(new Set(["sbx_known"]));

    await reapSandboxes();

    expect(mocks.pause).not.toHaveBeenCalled();
  });

  test("never touches execution sandboxes", async () => {
    // code-interpreter-v1 sandboxes are killed by e2b-run's own `finally` and
    // may be mid-execution; pausing one would break a running tool call.
    mocks.list.mockReturnValue(
      paginator([
        [
          {
            sandboxId: "sbx_exec",
            metadata: { template: "code-interpreter-v1" },
          },
        ],
      ]),
    );

    await reapSandboxes();

    expect(mocks.pause).not.toHaveBeenCalled();
  });

  test("skips orphans with no template metadata rather than guessing", async () => {
    mocks.list.mockReturnValue(paginator([[{ sandboxId: "sbx_x" }]]));

    await reapSandboxes();

    expect(mocks.pause).not.toHaveBeenCalled();
  });

  test("kills sandboxes that have been paused for a long time", async () => {
    mocks.listPausedBefore.mockResolvedValue([{ sandboxId: "sbx_stale" }]);

    const result = await reapSandboxes();

    expect(mocks.kill).toHaveBeenCalledWith("sbx_stale", expect.anything());
    expect(mocks.markState).toHaveBeenCalledWith("sbx_stale", "killed");
    expect(result.killed).toBe(1);
  });

  test("a sandbox that no longer exists is recorded, not retried forever", async () => {
    mocks.listIdleRunning.mockResolvedValue([{ sandboxId: "sbx_gone" }]);
    mocks.pause.mockRejectedValue(new Error("not found"));

    const result = await reapSandboxes();

    expect(mocks.markState).toHaveBeenCalledWith("sbx_gone", "killed");
    expect(result.failed).toBe(1);
    expect(result.paused).toBe(0);
  });

  test("an orphan-sweep failure does not abandon the rest of the run", async () => {
    mocks.list.mockImplementation(() => {
      throw new Error("e2b list unavailable");
    });
    mocks.listPausedBefore.mockResolvedValue([{ sandboxId: "sbx_stale" }]);

    const result = await reapSandboxes();

    expect(result.killed).toBe(1);
  });
});
