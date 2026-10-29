import { describe, expect, test } from "vitest";
import {
  QUEUED_RUN_STALE_MS,
  RUNNING_RUN_STALE_MS,
  isProjectRunActive,
  isProjectRunStale,
} from "./run-status";

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("isProjectRunStale", () => {
  test("a queued run that was never dispatched is stale immediately", () => {
    // inngest.send() failed, so enqueuedAt was never set and nothing will pick
    // this row up — the exact state that used to brick the Sync now button.
    const run = { status: "queued", enqueuedAt: null, createdAt: iso(1_000) };

    expect(isProjectRunStale(run, NOW)).toBe(true);
    expect(isProjectRunActive(run, NOW)).toBe(false);
  });

  test("a freshly dispatched queued run is active, not stale", () => {
    const run = {
      status: "queued",
      enqueuedAt: iso(2_000),
      createdAt: iso(3_000),
    };

    expect(isProjectRunStale(run, NOW)).toBe(false);
    expect(isProjectRunActive(run, NOW)).toBe(true);
  });

  test("a dispatched queued run goes stale past the queue cutoff", () => {
    const run = {
      status: "queued",
      enqueuedAt: iso(QUEUED_RUN_STALE_MS + 1_000),
      createdAt: iso(QUEUED_RUN_STALE_MS + 2_000),
    };

    expect(isProjectRunStale(run, NOW)).toBe(true);
    expect(isProjectRunActive(run, NOW)).toBe(false);
  });

  test("a running run stays active until the function timeout elapses", () => {
    const fresh = { status: "running", startedAt: iso(60_000) };
    const overdue = {
      status: "running",
      startedAt: iso(RUNNING_RUN_STALE_MS + 1_000),
    };

    expect(isProjectRunActive(fresh, NOW)).toBe(true);
    expect(isProjectRunStale(overdue, NOW)).toBe(true);
  });

  test("settled runs are never stale or active", () => {
    for (const status of ["succeeded", "failed", "partial", "skipped"]) {
      const run = { status, enqueuedAt: iso(RUNNING_RUN_STALE_MS * 10) };
      expect(isProjectRunStale(run, NOW)).toBe(false);
      expect(isProjectRunActive(run, NOW)).toBe(false);
    }
  });

  test("no run at all does not block a sync", () => {
    expect(isProjectRunActive(null, NOW)).toBe(false);
    expect(isProjectRunActive(undefined, NOW)).toBe(false);
    expect(isProjectRunStale(null, NOW)).toBe(false);
  });

  test("accepts Date objects as well as ISO strings", () => {
    const run = {
      status: "queued",
      enqueuedAt: new Date(NOW - QUEUED_RUN_STALE_MS - 1_000),
    };

    expect(isProjectRunStale(run, NOW)).toBe(true);
  });
});
