import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

// A tiny chainable stub standing in for the drizzle query builder. Each method
// returns `this`; the terminal await resolves to `rows`. `claimScheduledSlot`
// awaits an .update()...returning() chain and a .select()...limit() chain, so
// both terminate on the same resolved value — we drive them per-test.
function makeDb(selectRows: any[], updateRows: any[]) {
  const selectChain: any = {
    from: () => selectChain,
    leftJoin: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(selectRows),
    orderBy: () => Promise.resolve(selectRows),
    then: (r: any) => Promise.resolve(selectRows).then(r),
  };
  const updateChain: any = {
    set: () => updateChain,
    where: () => updateChain,
    returning: () => Promise.resolve(updateRows),
  };
  return {
    select: () => selectChain,
    update: () => updateChain,
  };
}

let db: any;
vi.mock("@/lib/db/pg/db.pg", () => ({
  get pgDb() {
    return db;
  },
}));

import { findDueScheduledTasks, claimScheduledSlot } from "./checker";

describe("findDueScheduledTasks", () => {
  beforeEach(() => {
    db = undefined;
  });

  it("returns a due task with its computed slot", async () => {
    db = makeDb(
      [
        {
          id: "task-1",
          userId: "u-1",
          cronExpression: "0 * * * *",
          timezone: "UTC",
          lastSlotAt: new Date("2026-07-22T06:00:00Z"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      [],
    );

    const due = await findDueScheduledTasks(new Date("2026-07-22T07:00:20Z"));

    expect(due).toEqual([
      {
        taskId: "task-1",
        userId: "u-1",
        slot: new Date("2026-07-22T07:00:00Z"),
      },
    ]);
  });

  it("omits a task that is not due yet", async () => {
    db = makeDb(
      [
        {
          id: "task-1",
          userId: "u-1",
          cronExpression: "0 * * * *",
          timezone: "UTC",
          lastSlotAt: new Date("2026-07-22T07:00:00Z"),
          createdAt: new Date("2026-07-01T00:00:00Z"),
        },
      ],
      [],
    );

    const due = await findDueScheduledTasks(new Date("2026-07-22T07:00:20Z"));

    expect(due).toEqual([]);
  });
});

describe("claimScheduledSlot", () => {
  it("wins when the conditional UPDATE affects a row", async () => {
    db = makeDb(
      [{ cronExpression: "0 * * * *", timezone: "UTC" }],
      [{ id: "task-1" }],
    );
    const won = await claimScheduledSlot(
      "task-1",
      new Date("2026-07-22T07:00:00Z"),
      new Date("2026-07-22T07:00:20Z"),
    );
    expect(won).toBe(true);
  });

  it("loses when the slot was already claimed (UPDATE affects nothing)", async () => {
    // Second concurrent caller for the same slot: the WHERE predicate no longer
    // matches (last_slot_at already advanced), so returning() is empty.
    db = makeDb([{ cronExpression: "0 * * * *", timezone: "UTC" }], []);
    const won = await claimScheduledSlot(
      "task-1",
      new Date("2026-07-22T07:00:00Z"),
      new Date("2026-07-22T07:00:20Z"),
    );
    expect(won).toBe(false);
  });
});
