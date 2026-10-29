import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { isInterruptedAssistantTail } from "./resumable-message";

type Tail = Pick<UIMessage, "role" | "metadata" | "parts">[];

const assistant = (runStatus?: string, parts: unknown[] = []): Tail =>
  [
    { role: "user", metadata: undefined, parts: [] },
    {
      role: "assistant",
      metadata: runStatus ? { runStatus } : undefined,
      parts,
    },
  ] as Tail;

describe("isInterruptedAssistantTail", () => {
  it("drops an assistant message whose run never finished", () => {
    expect(isInterruptedAssistantTail(assistant("running"))).toBe(true);
  });

  // The regression: a stale `runStatus: "running"` plus the old
  // "any trailing assistant message" rule deleted a complete answer on every
  // mount of the thread.
  it("keeps a finished answer", () => {
    for (const status of [
      "completed",
      "failed",
      "cancelled",
      "timed_out",
      "incomplete",
    ]) {
      expect(isInterruptedAssistantTail(assistant(status))).toBe(false);
    }
  });

  it("keeps an assistant message with no runStatus at all", () => {
    // Mid-stream the in-memory message carries no metadata yet. Silence is not
    // permission to delete it.
    expect(isInterruptedAssistantTail(assistant())).toBe(false);
  });

  it("never touches a user tail", () => {
    const userTail = [{ role: "user", metadata: undefined, parts: [] }] as Tail;
    expect(isInterruptedAssistantTail(userTail)).toBe(false);
  });

  it("no-ops on an empty conversation", () => {
    expect(isInterruptedAssistantTail([])).toBe(false);
  });

  // The iOS case: Safari freezes the backgrounded tab, the resume fires on
  // return, and dropping this message would unmount the runner that owes the
  // answer — starting a second sandbox for work already in flight.
  it("keeps a message holding an unanswered client tool call", () => {
    for (const state of ["input-available", "input-streaming"]) {
      const tail = assistant("running", [
        { type: "text", text: "one moment" },
        { type: "tool-python-execution", state, toolCallId: "call_1" },
      ]);
      expect(isInterruptedAssistantTail(tail)).toBe(false);
    }
  });

  it("still drops one whose tool calls have all been answered", () => {
    const tail = assistant("running", [
      { type: "tool-python-execution", state: "output-available" },
    ]);
    expect(isInterruptedAssistantTail(tail)).toBe(true);
  });

  it("ignores non-tool parts in the pending check", () => {
    const tail = assistant("running", [
      { type: "text", text: "partial answer", state: "input-available" },
    ]);
    expect(isInterruptedAssistantTail(tail)).toBe(true);
  });
});
