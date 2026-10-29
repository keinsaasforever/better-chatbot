import type { UIMessage } from "ai";
import type { ChatAttachment } from "app-types/chat";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pg/db.pg", () => ({ pgDb: {} }));
vi.mock("@/lib/db/pg/schema.pg", () => ({
  MemberTable: {},
  UserTable: {},
}));
vi.mock("auth/server", () => ({ getSession: vi.fn() }));

import { buildInitialMessageParts, resolveAbortOutcome } from "./route-helpers";

describe("buildInitialMessageParts", () => {
  test("makes a CSV source-url durable before the streamed turn starts", () => {
    const url =
      "https://x.supabase.co/storage/v1/object/public/attachments/u1/account.csv";
    const filename = "account-statement_21-Oct-2025_04-Aug-2026.csv";
    const currentParts = [
      {
        type: "text",
        text: `Attached files:\n1. ${filename} (text/csv)`,
        ingestionPreview: true,
      },
      {
        type: "text",
        text: "Create a visualization of our revenue in and out.",
      },
    ] as UIMessage["parts"];
    const attachments: ChatAttachment[] = [
      {
        type: "source-url",
        url,
        mediaType: "text/csv",
        filename,
      },
    ];

    const parts = buildInitialMessageParts(currentParts, attachments);

    expect(parts).toEqual([
      {
        type: "source-url",
        sourceId: url,
        url,
        mediaType: "text/csv",
        title: filename,
      },
      ...currentParts,
    ]);
  });
});

describe("resolveAbortOutcome", () => {
  test("a user stop is a cancelled run", () => {
    expect(resolveAbortOutcome({ userStopped: true })).toEqual({
      runStatus: "cancelled",
      error: { code: "aborted", retryable: true },
    });
  });

  test("an SDK chunk timeout is a timed-out run, not a stop", () => {
    const reason = new DOMException(
      "Chunk timeout of 45000ms exceeded",
      "TimeoutError",
    );
    const outcome = resolveAbortOutcome({ userStopped: false, reason });
    expect(outcome.runStatus).toBe("timed_out");
    expect(outcome.error).toEqual({ code: "run_timeout", retryable: true });
    expect(outcome.detail).toBe(
      "TimeoutError: Chunk timeout of 45000ms exceeded",
    );
  });

  test("an abort with no reason is still reported as a timeout", () => {
    const outcome = resolveAbortOutcome({ userStopped: false });
    expect(outcome.runStatus).toBe("timed_out");
    expect(outcome.detail).toMatch(/budget exhausted/);
  });
});
