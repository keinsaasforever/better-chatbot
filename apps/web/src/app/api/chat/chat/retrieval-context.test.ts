import { type ModelMessage, type UIMessage, convertToModelMessages } from "ai";
import { describe, expect, it } from "vitest";
import { ANTHROPIC_CACHE_CONTROL } from "lib/ai/prompt-cache";
import { buildCurrentDateTimePrompt } from "lib/ai/prompts";
import { appendRetrievalContext } from "./retrieval-context";

const conversation = (): ModelMessage[] =>
  [
    { role: "user", content: [{ type: "text", text: "earlier" }] },
    { role: "assistant", content: [{ type: "text", text: "ok" }] },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "what does the contract say?",
          providerOptions: ANTHROPIC_CACHE_CONTROL,
        },
      ],
    },
  ] as ModelMessage[];

const lastParts = (messages: ModelMessage[]) =>
  messages[messages.length - 1].content as any[];

describe("appendRetrievalContext", () => {
  it("appends context to the last message", () => {
    const result = appendRetrievalContext(conversation(), [
      "<project_knowledge_retrieval>[1] chunk</project_knowledge_retrieval>",
    ]);
    const parts = lastParts(result);

    expect(parts).toHaveLength(2);
    expect(parts[1].text).toContain("[1] chunk");
  });

  it("keeps the cache breakpoint on the user's question, not the context", () => {
    // The appended context is not persisted, so next turn's history ends at the
    // question. The breakpoint has to stay there for the span to match again.
    const parts = lastParts(
      appendRetrievalContext(conversation(), ["<x>chunk</x>"]),
    );

    expect(parts[0].providerOptions).toBe(ANTHROPIC_CACHE_CONTROL);
    expect(parts[1].providerOptions).toBeUndefined();
  });

  it("joins multiple context blocks", () => {
    const parts = lastParts(
      appendRetrievalContext(conversation(), ["<a>one</a>", "<b>two</b>"]),
    );

    expect(parts[1].text).toBe("<a>one</a>\n\n<b>two</b>");
  });

  it("leaves messages untouched when every block is empty", () => {
    const messages = conversation();
    expect(
      appendRetrievalContext(messages, ["", "   ", undefined, false]),
    ).toBe(messages);
  });

  it("does not touch earlier turns", () => {
    const messages = conversation();
    const result = appendRetrievalContext(messages, ["<x>chunk</x>"]);

    expect(result[0]).toBe(messages[0]);
    expect(result[1]).toBe(messages[1]);
  });

  it("promotes string content so the context has somewhere to go", () => {
    const messages = [{ role: "user", content: "plain" }] as ModelMessage[];
    const parts = lastParts(appendRetrievalContext(messages, ["<x>c</x>"]));

    expect(parts).toEqual([
      { type: "text", text: "plain" },
      { type: "text", text: "<x>c</x>" },
    ]);
  });

  // The clock used to be the last block of the *system* prompt. Caching is a
  // prefix match and the breakpoint sits at the end of that block, so the
  // timestamp was inside the cached span: neither breakpoint could hit across a
  // clock minute. Being "last" inside the system prompt did not help - it has
  // to be out here, past the breakpoint.
  it("carries a per-request timestamp past the breakpoint", () => {
    const parts = lastParts(
      appendRetrievalContext(conversation(), [
        "<sandbox_assets>https://example.test/a.png</sandbox_assets>",
        buildCurrentDateTimePrompt(),
      ]),
    );

    expect(parts[0].providerOptions).toBe(ANTHROPIC_CACHE_CONTROL);
    expect(parts[0].text).toBe("what does the contract say?");
    expect(parts[1].text).toContain("The current date and time is");
    expect(parts[1].providerOptions).toBeUndefined();
  });

  it("no-ops on an empty conversation", () => {
    const messages: ModelMessage[] = [];
    expect(appendRetrievalContext(messages, ["<x>c</x>"])).toBe(messages);
  });
});

/**
 * A `tool` message's content is `ToolResultPart[]`. Pushing a text part into
 * one makes the whole array fail the SDK's prompt validation with
 * "The messages do not match the ModelMessage[] schema", which killed every
 * turn that came back through a client-side tool. Every fixture above ends on a
 * user message, which is why the original went out.
 */
const toolResultParts = (messages: ModelMessage[]) =>
  messages
    .filter((message) => message.role === "tool")
    .flatMap((message) =>
      Array.isArray(message.content) ? message.content : [],
    );

describe("appendRetrievalContext on a tool-call round-trip", () => {
  const afterToolResult = (): ModelMessage[] =>
    [
      { role: "user", content: [{ type: "text", text: "what is my name?" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "requestInput",
            input: { label: "Your name" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "requestInput",
            output: { type: "json", value: { value: "Paul" } },
          },
        ],
      },
    ] as ModelMessage[];

  it("never puts a text part in a tool message", () => {
    const result = appendRetrievalContext(afterToolResult(), [
      buildCurrentDateTimePrompt(),
    ]);

    expect(
      toolResultParts(result).every((part) => part.type === "tool-result"),
    ).toBe(true);
  });

  it("carries the context in its own trailing user message instead", () => {
    const messages = afterToolResult();
    const result = appendRetrievalContext(messages, ["<x>chunk</x>"]);

    expect(result).toHaveLength(messages.length + 1);
    expect(result[messages.length - 1]).toBe(messages[messages.length - 1]);
    expect(result.at(-1)).toEqual({
      role: "user",
      content: [{ type: "text", text: "<x>chunk</x>" }],
    });
  });

  it("does the same for an assistant message holding a pending tool call", () => {
    // Approval mode and every HITL tool stop here: the call is emitted, the
    // result comes from the browser. A part appended after the tool call would
    // sit between it and its result.
    const messages = afterToolResult().slice(0, 2);
    const result = appendRetrievalContext(messages, ["<x>chunk</x>"]);

    expect(result[1]).toBe(messages[1]);
    expect(result.at(-1)?.role).toBe("user");
  });

  // The premise, through the real SDK rather than a hand-built fixture: a turn
  // resumed by `addToolResult` re-enters the route with the assistant message
  // last, and `convertToModelMessages` ends that on a `tool` message.
  it("holds for a history the SDK itself converted", async () => {
    const history: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "what is my name?" }],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-requestInput",
            toolCallId: "call-1",
            state: "output-available",
            input: { label: "Your name" },
            output: { value: "Paul" },
          },
        ],
      } as unknown as UIMessage,
    ];

    // `convertToModelMessages` is async in this SDK version — the route awaits
    // it too. Without the await every assertion below runs against a Promise.
    const converted = await convertToModelMessages(history);
    expect(converted.at(-1)?.role).toBe("tool");

    const result = appendRetrievalContext(converted, [
      buildCurrentDateTimePrompt(),
    ]);

    expect(
      toolResultParts(result).every((part) => part.type === "tool-result"),
    ).toBe(true);
    expect(result.at(-1)?.role).toBe("user");
  });
});
