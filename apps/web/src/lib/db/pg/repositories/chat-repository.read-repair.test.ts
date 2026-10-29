import { beforeEach, describe, expect, it, vi } from "vitest";

// The windowed read path read-repairs orphaned "running" runs. We mock the db
// layer (org-scope.test.ts pattern) so the fetched rows are fully controlled
// and the UPDATE is observed without a live database.
const h = vi.hoisted(() => ({
  rows: [] as any[],
  updateCalls: 0,
}));

vi.mock("../db.pg", () => ({
  pgDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: () => Promise.resolve(h.rows) }),
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          h.updateCalls += 1;
          return Promise.resolve();
        },
      }),
    }),
  },
}));

const { pgChatRepository } = await import("./chat-repository.pg");

const OLD = new Date(Date.now() - 7 * 60_000); // > 6 min → orphaned
const NEW = new Date(); // fresh → in-flight

beforeEach(() => {
  h.rows = [];
  h.updateCalls = 0;
});

describe("selectMessagesByThreadId orphaned-run repair", () => {
  it("flips a stale running message to failed/orphaned and issues one UPDATE", async () => {
    h.rows = [{ id: "m1", metadata: { runStatus: "running" }, createdAt: OLD }];
    const [msg] = await pgChatRepository.selectMessagesByThreadId("t", {
      limit: 10,
    });
    expect(h.updateCalls).toBe(1);
    expect(msg.metadata?.runStatus).toBe("failed");
    expect(msg.metadata?.error).toEqual({ code: "orphaned", retryable: true });
  });

  it("leaves a recently-started running message alone", async () => {
    h.rows = [{ id: "m1", metadata: { runStatus: "running" }, createdAt: NEW }];
    const [msg] = await pgChatRepository.selectMessagesByThreadId("t", {
      limit: 10,
    });
    expect(h.updateCalls).toBe(0);
    expect(msg.metadata?.runStatus).toBe("running");
  });

  it("does not touch already-terminal messages", async () => {
    h.rows = [
      { id: "m1", metadata: { runStatus: "completed" }, createdAt: OLD },
    ];
    const [msg] = await pgChatRepository.selectMessagesByThreadId("t", {
      limit: 10,
    });
    expect(h.updateCalls).toBe(0);
    expect(msg.metadata?.runStatus).toBe("completed");
  });
});
