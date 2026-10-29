import { describe, expect, it } from "vitest";
import {
  CATCH_UP_WINDOW_MS,
  computeDueSlot,
  scheduledRunEventId,
} from "./due-detection";

// "0 9 * * *" in Europe/Berlin: 07:00Z in summer (UTC+2), 08:00Z in winter.
const DAILY_9_BERLIN = {
  cronExpression: "0 9 * * *",
  timezone: "Europe/Berlin",
};

describe("computeDueSlot", () => {
  it("fires the first slot for a task that has never run (1970-anchor regression)", () => {
    const slot = computeDueSlot(
      {
        ...DAILY_9_BERLIN,
        lastSlotAt: null,
        createdAt: new Date("2026-07-22T06:00:00Z"),
      },
      new Date("2026-07-22T07:00:30Z"),
    );
    expect(slot?.toISOString()).toBe("2026-07-22T07:00:00.000Z");
  });

  it("does not fire a slot that predates the task's creation", () => {
    const slot = computeDueSlot(
      {
        ...DAILY_9_BERLIN,
        lastSlotAt: null,
        createdAt: new Date("2026-07-22T07:30:00Z"),
      },
      new Date("2026-07-22T07:31:00Z"),
    );
    expect(slot).toBeNull();
  });

  it("does not fire again once the slot has been claimed (lastSlotAt past it)", () => {
    const slot = computeDueSlot(
      {
        ...DAILY_9_BERLIN,
        lastSlotAt: new Date("2026-07-22T07:00:40Z"),
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      new Date("2026-07-22T07:01:30Z"),
    );
    expect(slot).toBeNull();
  });

  it("does not skip an occurrence when a prior run overran its interval", () => {
    // Hourly. The 06:00 slot was CLAIMED (lastSlotAt=06:00) but its run is still
    // in flight at 07:00 — completion (lastRunAt) has not landed yet. Flooring on
    // lastSlotAt (not lastRunAt) means the 07:00 slot is still due. The previous
    // completion-based floor would have skipped it if the run finished > 07:00.
    const slot = computeDueSlot(
      {
        cronExpression: "0 * * * *",
        timezone: "UTC",
        lastSlotAt: new Date("2026-07-22T06:00:00Z"),
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      new Date("2026-07-22T07:00:20Z"),
    );
    expect(slot?.toISOString()).toBe("2026-07-22T07:00:00.000Z");
  });

  it("re-detects an in-flight slot on later ticks (event id dedupes it)", () => {
    // lastRunAt still predates the slot while the run is executing.
    const task = {
      ...DAILY_9_BERLIN,
      lastSlotAt: new Date("2026-07-21T07:00:35Z"),
      createdAt: new Date("2026-07-01T00:00:00Z"),
    };
    const first = computeDueSlot(task, new Date("2026-07-22T07:00:20Z"));
    const second = computeDueSlot(task, new Date("2026-07-22T07:02:20Z"));
    expect(first?.toISOString()).toBe("2026-07-22T07:00:00.000Z");
    expect(second?.toISOString()).toBe("2026-07-22T07:00:00.000Z");
    expect(scheduledRunEventId("t1", first!)).toBe(
      scheduledRunEventId("t1", second!),
    );
  });

  it("recovers a missed checker tick within the catch-up window", () => {
    const slot = computeDueSlot(
      {
        ...DAILY_9_BERLIN,
        lastSlotAt: new Date("2026-07-21T07:00:35Z"),
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      new Date("2026-07-22T07:03:10Z"),
    );
    expect(slot?.toISOString()).toBe("2026-07-22T07:00:00.000Z");
  });

  it("drops slots older than the catch-up window instead of replaying history", () => {
    const slotTime = new Date("2026-07-22T07:00:00Z").getTime();
    const slot = computeDueSlot(
      {
        ...DAILY_9_BERLIN,
        lastSlotAt: new Date("2026-07-21T07:00:35Z"),
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      new Date(slotTime + CATCH_UP_WINDOW_MS + 60_000),
    );
    expect(slot).toBeNull();
  });

  it("evaluates the cron in the task's timezone (winter offset)", () => {
    const slot = computeDueSlot(
      {
        ...DAILY_9_BERLIN,
        lastSlotAt: new Date("2026-01-14T08:00:30Z"),
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      new Date("2026-01-15T08:00:45Z"),
    );
    expect(slot?.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("fires hourly schedules every hour", () => {
    const slot = computeDueSlot(
      {
        cronExpression: "0 * * * *",
        timezone: "UTC",
        lastSlotAt: new Date("2026-07-22T06:00:20Z"),
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      new Date("2026-07-22T07:00:10Z"),
    );
    expect(slot?.toISOString()).toBe("2026-07-22T07:00:00.000Z");
  });

  it("does not throw across a DST spring-forward gap", () => {
    // Europe/Berlin skips 02:00-03:00 on 2026-03-29.
    expect(() =>
      computeDueSlot(
        {
          cronExpression: "30 2 * * *",
          timezone: "Europe/Berlin",
          lastSlotAt: new Date("2026-03-28T01:30:40Z"),
          createdAt: new Date("2026-03-01T00:00:00Z"),
        },
        new Date("2026-03-29T01:35:00Z"),
      ),
    ).not.toThrow();
  });

  it("returns null for an invalid cron expression", () => {
    const slot = computeDueSlot(
      {
        cronExpression: "not a cron",
        timezone: "UTC",
        lastSlotAt: null,
        createdAt: new Date("2026-07-01T00:00:00Z"),
      },
      new Date("2026-07-22T07:00:00Z"),
    );
    expect(slot).toBeNull();
  });

  it("accepts string dates (JSON-serialized rows)", () => {
    const slot = computeDueSlot(
      {
        ...DAILY_9_BERLIN,
        lastSlotAt: "2026-07-21T07:00:35.000Z",
        createdAt: "2026-07-01T00:00:00.000Z",
      },
      new Date("2026-07-22T07:00:20Z"),
    );
    expect(slot?.toISOString()).toBe("2026-07-22T07:00:00.000Z");
  });
});

describe("scheduledRunEventId", () => {
  it("is deterministic per (task, slot) and unique across slots", () => {
    const slotA = new Date("2026-07-22T07:00:00Z");
    const slotB = new Date("2026-07-23T07:00:00Z");
    expect(scheduledRunEventId("task-1", slotA)).toBe(
      scheduledRunEventId("task-1", slotA),
    );
    expect(scheduledRunEventId("task-1", slotA)).not.toBe(
      scheduledRunEventId("task-1", slotB),
    );
    expect(scheduledRunEventId("task-1", slotA)).not.toBe(
      scheduledRunEventId("task-2", slotA),
    );
  });
});
