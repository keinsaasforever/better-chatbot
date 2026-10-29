import { beforeEach, describe, expect, it, vi } from "vitest";

// Titling races the chat run's thread insert, so both writes have to be
// conflict-safe. We mock the db layer (read-repair.test.ts pattern) to observe
// the emitted statements without a live database.
const h = vi.hoisted(() => ({
  // Rows returned by the conditional UPDATE ... RETURNING (empty = no match).
  updateReturning: [] as any[],
  // Rows returned by the follow-up SELECT.
  selectRows: [] as any[],
  // Rows returned by INSERT ... ON CONFLICT DO NOTHING RETURNING.
  insertReturning: [] as any[],
  updateCalls: 0,
  conflictTargets: [] as any[],
}));

vi.mock("../db.pg", () => ({
  pgDb: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(h.selectRows),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          h.updateCalls += 1;
          return { returning: () => Promise.resolve(h.updateReturning) };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: (config: any) => {
          h.conflictTargets.push(config);
          return { returning: () => Promise.resolve(h.insertReturning) };
        },
      }),
    }),
  },
}));

const { pgChatRepository } = await import("./chat-repository.pg");

beforeEach(() => {
  h.updateReturning = [];
  h.selectRows = [];
  h.insertReturning = [];
  h.updateCalls = 0;
  h.conflictTargets = [];
});

describe("setThreadTitleIfEmpty", () => {
  it("writes and returns the title when the thread is still untitled", async () => {
    h.updateReturning = [{ title: "Quarterly budget review" }];
    await expect(
      pgChatRepository.setThreadTitleIfEmpty("t1", "Quarterly budget review"),
    ).resolves.toBe("Quarterly budget review");
    expect(h.updateCalls).toBe(1);
  });

  it("keeps the stored title when another writer got there first", async () => {
    h.updateReturning = [];
    h.selectRows = [{ title: "Already titled" }];
    await expect(
      pgChatRepository.setThreadTitleIfEmpty("t1", "Second attempt"),
    ).resolves.toBe("Already titled");
  });

  it("never issues a write for an empty title", async () => {
    h.selectRows = [{ title: "" }];
    await expect(
      pgChatRepository.setThreadTitleIfEmpty("t1", "  "),
    ).resolves.toBe("");
    expect(h.updateCalls).toBe(0);
  });

  it("reports an empty title for a thread that no longer exists", async () => {
    h.updateReturning = [];
    h.selectRows = [];
    await expect(
      pgChatRepository.setThreadTitleIfEmpty("gone", "Anything"),
    ).resolves.toBe("");
  });
});

describe("insertThreadWithDefaults", () => {
  it("returns the inserted thread", async () => {
    h.insertReturning = [
      {
        id: "t1",
        title: "",
        userId: "u1",
        projectId: null,
        createdAt: new Date(),
      },
    ];
    const thread = await pgChatRepository.insertThreadWithDefaults({
      id: "t1",
      title: "",
      userId: "u1",
    });
    expect(thread.id).toBe("t1");
    expect(thread.messages).toEqual([]);
    expect(h.conflictTargets).toHaveLength(1);
  });

  it("falls back to the existing row when a concurrent writer won the insert", async () => {
    h.insertReturning = [];
    const details = vi
      .spyOn(pgChatRepository, "selectThreadDetails")
      .mockResolvedValue({
        id: "t1",
        title: "Titled by the titling request",
        userId: "u1",
        createdAt: new Date(),
        messages: [],
      } as any);

    const thread = await pgChatRepository.insertThreadWithDefaults({
      id: "t1",
      title: "",
      userId: "u1",
    });
    expect(thread.title).toBe("Titled by the titling request");
    details.mockRestore();
  });
});
