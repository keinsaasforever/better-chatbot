import { beforeEach, describe, expect, it, vi } from "vitest";

// Knowledge sources attached in the composer are stored on the thread itself.
// The write must stay owner-scoped and must never create a row: an empty
// thread would surface in the sidebar as a phantom chat. Mocks follow the
// read-repair.test.ts pattern so no live database is needed.
const h = vi.hoisted(() => ({
  updateReturning: [] as any[],
  insertReturning: [] as any[],
  setPayloads: [] as any[],
  insertValues: [] as any[],
  insertCalls: 0,
}));

vi.mock("../db.pg", () => ({
  pgDb: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    update: () => ({
      set: (payload: any) => {
        h.setPayloads.push(payload);
        return {
          where: () => ({
            returning: () => Promise.resolve(h.updateReturning),
          }),
        };
      },
    }),
    insert: () => ({
      values: (values: any) => {
        h.insertCalls += 1;
        h.insertValues.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(h.insertReturning),
          }),
          returning: () => Promise.resolve(h.insertReturning),
        };
      },
    }),
  },
}));

const { pgChatRepository } = await import("./chat-repository.pg");

const BINDINGS = [
  { type: "kb" as const, id: "kb-1", name: "Building law" },
  { type: "project" as const, id: "p-1", name: "Navigator" },
];

beforeEach(() => {
  h.updateReturning = [];
  h.insertReturning = [];
  h.setPayloads = [];
  h.insertValues = [];
  h.insertCalls = 0;
});

describe("setThreadKnowledgeBases", () => {
  it("stores the bindings and reports the write landed", async () => {
    h.updateReturning = [{ id: "t1" }];
    await expect(
      pgChatRepository.setThreadKnowledgeBases("t1", "u1", BINDINGS),
    ).resolves.toBe(true);
    expect(h.setPayloads).toEqual([{ knowledgeBases: BINDINGS }]);
  });

  /**
   * The composer fires this on every toggle, including on a draft thread whose
   * first message is still unsent. No row matches, and the call must resolve
   * quietly rather than insert one.
   */
  it("reports no write and creates nothing when no owned thread matches", async () => {
    h.updateReturning = [];
    await expect(
      pgChatRepository.setThreadKnowledgeBases("draft", "u1", BINDINGS),
    ).resolves.toBe(false);
    expect(h.insertCalls).toBe(0);
  });

  it("clears the bindings when the last one is detached", async () => {
    h.updateReturning = [{ id: "t1" }];
    await pgChatRepository.setThreadKnowledgeBases("t1", "u1", []);
    expect(h.setPayloads).toEqual([{ knowledgeBases: [] }]);
  });
});

describe("insertThreadWithDefaults", () => {
  it("persists what the composer attached before the first message", async () => {
    h.insertReturning = [
      {
        id: "t1",
        title: "",
        userId: "u1",
        projectId: null,
        knowledgeBases: BINDINGS,
        createdAt: new Date(),
      },
    ];
    await pgChatRepository.insertThreadWithDefaults({
      id: "t1",
      title: "",
      userId: "u1",
      knowledgeBases: BINDINGS,
    });
    expect(h.insertValues[0]?.knowledgeBases).toEqual(BINDINGS);
  });

  it("defaults to no knowledge sources for an ordinary new thread", async () => {
    h.insertReturning = [
      {
        id: "t2",
        title: "",
        userId: "u1",
        projectId: null,
        knowledgeBases: [],
        createdAt: new Date(),
      },
    ];
    await pgChatRepository.insertThreadWithDefaults({
      id: "t2",
      title: "",
      userId: "u1",
    });
    expect(h.insertValues[0]?.knowledgeBases).toEqual([]);
  });
});
