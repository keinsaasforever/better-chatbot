import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  COMPACT_KEEP_RECENT_MESSAGES,
  compactLoopMessages,
} from "./compact-loop-messages";

const call = (id: string): ModelMessage => ({
  role: "assistant",
  content: [
    { type: "reasoning", text: `thinking about ${id}` },
    {
      type: "tool-call",
      toolCallId: id,
      toolName: "readDocument",
      input: { name: id },
    },
  ],
});

const result = (id: string, size = 400): ModelMessage => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      toolCallId: id,
      toolName: "readDocument",
      output: { type: "text", value: "X".repeat(size) },
    },
  ],
});

const loop = (pairs: number): ModelMessage[] =>
  Array.from({ length: pairs }, (_, i) => [
    call(`c${i}`),
    result(`c${i}`),
  ]).flat();

/** Tool result ids with no matching tool call - a provider 400 waiting to happen. */
const orphanedResults = (messages: ModelMessage[]): string[] => {
  const calls = new Set<string>();
  const results: string[] = [];
  for (const message of messages) {
    if (
      (message.role !== "assistant" && message.role !== "tool") ||
      typeof message.content === "string"
    ) {
      continue;
    }
    for (const part of message.content) {
      if (part.type === "tool-call") calls.add(part.toolCallId);
      else if (part.type === "tool-result") results.push(part.toolCallId);
    }
  }
  return results.filter((id) => !calls.has(id));
};

const serialized = (messages: ModelMessage[]) => JSON.stringify(messages);

describe("compactLoopMessages", () => {
  it("drops tool payloads from older loop messages", () => {
    const messages = loop(8);
    const compacted = compactLoopMessages(messages);

    expect(compacted).toBeDefined();
    expect(serialized(compacted!).length).toBeLessThan(
      serialized(messages).length,
    );
    // Only from the compacted span - the kept tail still carries its payloads,
    // which is the point of keeping it.
    const head = compacted!.slice(0, -COMPACT_KEEP_RECENT_MESSAGES);
    expect(serialized(head)).not.toContain("X".repeat(400));
  });

  it("leaves the most recent loop messages byte-identical", () => {
    const messages = loop(8);
    const compacted = compactLoopMessages(messages)!;

    expect(compacted.slice(-COMPACT_KEEP_RECENT_MESSAGES)).toEqual(
      messages.slice(-COMPACT_KEEP_RECENT_MESSAGES),
    );
  });

  it("strips reasoning from the compacted span but keeps it in the tail", () => {
    const messages = loop(8);
    const compacted = compactLoopMessages(messages)!;
    const head = compacted.slice(0, -COMPACT_KEEP_RECENT_MESSAGES);

    expect(serialized(head)).not.toContain("thinking about");
    expect(
      serialized(compacted.slice(-COMPACT_KEEP_RECENT_MESSAGES)),
    ).toContain("thinking about");
  });

  // The reason this helper exists: the previous implementation sliced the
  // array before pruning, so a boundary landing between a tool call and its
  // result dropped the call and kept the result.
  it("never orphans a tool result, whatever the boundary lands on", () => {
    for (let pairs = 1; pairs <= 12; pairs++) {
      const messages = loop(pairs);
      // Also cover the odd-length shapes an approval or a dropped incomplete
      // call produces, which is what flips the boundary onto a tool message.
      const trailingText: ModelMessage = {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
      };
      for (const messagesUnderTest of [messages, [...messages, trailingText]]) {
        const compacted = compactLoopMessages(messagesUnderTest);
        expect(orphanedResults(compacted ?? messagesUnderTest)).toEqual([]);
      }
    }
  });

  it("skips compaction when a result answers a call made outside the loop", () => {
    // A `needsApproval` tool: the SDK puts the result in the response messages
    // while the call stays in initialMessages. Pruning it would leave that
    // call unanswered.
    const messages = [result("approved-before-the-loop"), ...loop(6)];

    expect(compactLoopMessages(messages)).toBeUndefined();
  });

  // What the route composes: `[...initialMessages, ...compacted]`. The helper
  // never sees the conversation, so an uploaded document - which lives on the
  // user message as a file part plus its extracted text - cannot be dropped.
  it("cannot touch the conversation the loop was started from", () => {
    const initialMessages: ModelMessage[] = [
      { role: "user", content: [{ type: "text", text: "earlier question" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: "earlier answer" }],
      },
      {
        role: "user",
        content: [
          { type: "text", text: "summarise the attached contract" },
          {
            type: "file",
            mediaType: "application/pdf",
            data: "JVBERi0xLjQK",
          },
          { type: "text", text: `CONTRACT TEXT ${"Y".repeat(500)}` },
        ],
      },
    ];
    const compacted = compactLoopMessages(loop(8))!;

    expect([...initialMessages, ...compacted].slice(0, 3)).toEqual(
      initialMessages,
    );
  });

  it("skips compaction when there is nothing to remove", () => {
    const messages: ModelMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "short answer" }] },
    ];

    expect(compactLoopMessages(messages)).toBeUndefined();
    expect(compactLoopMessages([])).toBeUndefined();
  });
});
