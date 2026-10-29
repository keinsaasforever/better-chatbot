import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  type PersistedTailRow,
  isTerminalRunStatus,
  reconcilePersistedTail,
} from "./persisted-tail";

type Row = PersistedTailRow & { threadId?: string; createdAt?: Date };

const user = (id: string, runStatus?: string): UIMessage =>
  ({
    id,
    role: "user",
    parts: [{ type: "text", text: `question ${id}` }],
    metadata: runStatus ? { runStatus } : undefined,
  }) as UIMessage;

const assistant = (
  id: string,
  runStatus?: string,
  parts: unknown[] = [{ type: "text", text: `answer ${id}` }],
): UIMessage =>
  ({
    id,
    role: "assistant",
    parts,
    metadata: runStatus ? { runStatus } : undefined,
  }) as UIMessage;

/** What the repository returns: a UI message plus the DB-only columns. */
const row = (message: UIMessage): Row => ({
  ...message,
  threadId: "thread-1",
  createdAt: new Date(0),
});

const older = [user("u0", "completed"), assistant("a0", "completed")];

describe("isTerminalRunStatus", () => {
  it("treats a missing status as finished", () => {
    expect(isTerminalRunStatus(undefined)).toBe(true);
  });

  it("only keeps waiting on running and queued", () => {
    expect(isTerminalRunStatus("running")).toBe(false);
    expect(isTerminalRunStatus("queued")).toBe(false);
    for (const status of [
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "incomplete",
    ]) {
      expect(isTerminalRunStatus(status)).toBe(true);
    }
  });
});

describe("reconcilePersistedTail", () => {
  it("replaces the current turn with the persisted answer once the run ended", () => {
    const client = [...older, user("u1"), assistant("a1", undefined, [])];
    const persisted = [
      row(older[1]),
      row(user("u1", "completed")),
      row(assistant("a1", "completed")),
    ];

    const result = reconcilePersistedTail(client, persisted);

    expect(result.kind).toBe("settled");
    if (result.kind !== "settled") return;
    expect(result.messages.map((m) => m.id)).toEqual(["u0", "a0", "u1", "a1"]);
    // Older history the window does not cover is kept verbatim.
    expect(result.messages[0]).toBe(client[0]);
    expect(result.messages[1]).toBe(client[1]);
    // The partial client answer gave way to the persisted one, mapped down to
    // UI fields only.
    expect(result.messages[3]).toEqual(assistant("a1", "completed"));
    expect(result.messages[3]).not.toHaveProperty("threadId");
  });

  it("settles a failed run that never produced an assistant row", () => {
    const client = [...older, user("u1"), assistant("a1", undefined, [])];
    const persisted = [row(older[1]), row(user("u1", "failed"))];

    const result = reconcilePersistedTail(client, persisted);

    expect(result.kind).toBe("settled");
    if (result.kind !== "settled") return;
    expect(result.messages.map((m) => m.id)).toEqual(["u0", "a0", "u1"]);
    expect(result.messages[2]).toEqual(user("u1", "failed"));
  });

  it("keeps waiting while the server is still running the turn", () => {
    const client = [...older, user("u1")];
    const persisted = [row(older[1]), row(user("u1", "running"))];

    expect(reconcilePersistedTail(client, persisted)).toEqual({
      kind: "running",
    });
  });

  // onEnd flips the user row before it writes the assistant row.
  it("keeps waiting when only the user row has finished", () => {
    const client = [...older, user("u1"), assistant("a1", undefined, [])];
    for (const status of ["completed", "incomplete"]) {
      const persisted = [row(older[1]), row(user("u1", status))];
      expect(reconcilePersistedTail(client, persisted)).toEqual({
        kind: "running",
      });
    }
  });

  it("settles a tool-result continuation that reused the assistant id", () => {
    const toolCall = {
      type: "tool-python-execution",
      toolCallId: "call-1",
      state: "output-available",
      input: {},
      output: { ok: true },
    };
    const client = [
      ...older,
      user("u1", "completed"),
      assistant("a1", undefined, [toolCall]),
    ];
    const persisted = [
      row(user("u1", "completed")),
      row(
        assistant("a1", "completed", [
          toolCall,
          { type: "text", text: "done" },
        ]),
      ),
    ];

    const result = reconcilePersistedTail(client, persisted);

    expect(result.kind).toBe("settled");
    if (result.kind !== "settled") return;
    expect(result.messages.at(-1)?.parts).toHaveLength(2);
  });

  it("does not overwrite a tool result the server never received", () => {
    const pending = {
      type: "tool-python-execution",
      toolCallId: "call-1",
      state: "input-available",
      input: {},
    };
    const answered = { ...pending, state: "output-available", output: {} };
    const client = [
      ...older,
      user("u1"),
      assistant("a1", undefined, [answered]),
    ];
    const persisted = [
      row(user("u1", "completed")),
      row(assistant("a1", "completed", [pending])),
    ];

    expect(reconcilePersistedTail(client, persisted)).toEqual({
      kind: "client-ahead",
    });
  });

  it("reports unknown when the user turn never reached the server", () => {
    const client = [...older, user("u1")];
    const persisted = [row(older[0]), row(older[1])];

    expect(reconcilePersistedTail(client, persisted)).toEqual({
      kind: "unknown",
    });
  });

  it("reports unknown without any user message", () => {
    expect(reconcilePersistedTail([], [])).toEqual({ kind: "unknown" });
    expect(
      reconcilePersistedTail([assistant("a1")], [row(assistant("a1"))]),
    ).toEqual({ kind: "unknown" });
  });
});
