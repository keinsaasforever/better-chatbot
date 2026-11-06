import { beforeEach, describe, expect, it, vi } from "vitest";

// A member's cap is a fixed total: spend from earlier months must keep
// counting after the calendar month rolls over. The DB is mocked down to the
// calls `reserveMemberBudget` makes; `spentRows` is what the lifetime
// SUM over every usage-period row returns.
let spentRows: Array<{ memberId: string; spentMicros: string }> = [];
const insertedReservations: unknown[] = [];

const tx = {
  execute: vi.fn(async () => undefined),
  query: {
    MemberAiPolicyTable: {
      findFirst: vi.fn(async () => ({
        monthlyCapMicros: 5_000_000,
        hardStop: true,
      })),
    },
    MemberAiUsagePeriodTable: {
      // This month's row is empty: the old per-month check saw 0 here and let
      // a member who had spent their whole allowance last month start over.
      findFirst: vi.fn(async () => ({
        id: "period-nov",
        finalizedMicros: 0,
        reservedMicros: 0,
      })),
    },
    MemberAiReservationTable: { findFirst: vi.fn(async () => undefined) },
  },
  select: vi.fn(() => ({
    from: () => ({ where: () => ({ groupBy: async () => spentRows }) }),
  })),
  insert: vi.fn(() => ({
    values: (values: unknown) => ({
      onConflictDoNothing: async () => undefined,
      returning: async () => {
        insertedReservations.push(values);
        return [{ id: "reservation-1" }];
      },
    }),
  })),
  update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    query: {
      MemberAiPolicyTable: {
        findFirst: async () => ({
          monthlyCapMicros: 5_000_000,
          hardStop: true,
        }),
      },
    },
    transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}));

const { reserveMemberBudget, MemberBudgetExceededError } = await import(
  "./budget"
);

const reserve = () =>
  reserveMemberBudget({
    memberId: "member-1",
    deploymentId: "deployment-1",
    estimateMicros: 1_000_000,
    idempotencyKey: "run-1",
  });

describe("reserveMemberBudget lifetime cap", () => {
  beforeEach(() => {
    insertedReservations.length = 0;
  });

  it("reserves while total spend across all months stays under the cap", async () => {
    spentRows = [{ memberId: "member-1", spentMicros: "2249905" }];
    await expect(reserve()).resolves.toEqual({ id: "reservation-1" });
    expect(insertedReservations).toHaveLength(1);
  });

  it("refuses once earlier months' spend uses up the cap, even in a new month", async () => {
    // €4.50 spent in October, nothing yet in November, cap €5: a €1 run
    // would take the total to €5.50.
    spentRows = [{ memberId: "member-1", spentMicros: "4500000" }];
    await expect(reserve()).rejects.toBeInstanceOf(MemberBudgetExceededError);
    expect(insertedReservations).toHaveLength(0);
  });
});
