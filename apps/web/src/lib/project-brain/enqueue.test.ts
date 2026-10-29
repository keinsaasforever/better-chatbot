import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  insertReturning: [] as unknown[],
  updates: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/inngest/client", () => ({
  inngest: { send: (...args: unknown[]) => mocks.send(...args) },
}));

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(mocks.insertReturning),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

import { enqueueProjectBrainRun } from "./enqueue";

const RUN = {
  id: "8f14e45f-ceea-467a-a3a5-1f0dbcd1f0db",
  projectId: "1e0f8f7a-1111-4222-8333-444455556666",
  enqueuedAt: null,
};

function enqueue() {
  return enqueueProjectBrainRun({
    projectId: RUN.projectId,
    actorUserId: "3e0f8f7a-1111-4222-8333-444455556666",
    sourceType: "tool_sync",
    sourceRef: "connector-1",
    sourceScope: "tool:connector-1",
    trigger: "manual_sync",
    idempotencyKey: "key-1",
  });
}

describe("enqueueProjectBrainRun", () => {
  beforeEach(() => {
    mocks.send.mockReset();
    mocks.updates.length = 0;
    mocks.insertReturning = [{ ...RUN }];
  });

  test("marks enqueuedAt once the event is dispatched", async () => {
    mocks.send.mockResolvedValue(undefined);

    await enqueue();

    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({ errorCode: null });
    expect(mocks.updates[0].enqueuedAt).toBeInstanceOf(Date);
  });

  test("fails the run instead of leaving it queued when dispatch throws", async () => {
    // A row left at "queued" reads as an in-flight sync and blocks every later
    // retry, so a dispatch failure has to settle the row.
    mocks.send.mockRejectedValue(new Error("Could not find event key"));

    await expect(enqueue()).rejects.toThrow("Could not find event key");

    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({
      status: "failed",
      errorCode: "enqueue_failed",
    });
    // Never echo the underlying error: runs/latest serves this row to the client.
    expect(mocks.updates[0].errorMessage).toBe(
      "Could not start the background job.",
    );
  });

  test("does not re-dispatch a run that was already enqueued", async () => {
    mocks.insertReturning = [{ ...RUN, enqueuedAt: new Date() }];

    await enqueue();

    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.updates).toHaveLength(0);
  });
});
