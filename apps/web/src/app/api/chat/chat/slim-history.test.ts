import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { SLIM_MAX_PART_CHARS, slimHistoryForModel } from "./slim-history";

const big = (n = SLIM_MAX_PART_CHARS + 500) => "x".repeat(n);

const user = (parts: any[]): UIMessage =>
  ({ id: crypto.randomUUID(), role: "user", parts }) as UIMessage;
const assistant = (parts: any[]): UIMessage =>
  ({ id: crypto.randomUUID(), role: "assistant", parts }) as UIMessage;

const preview = (text: string) => ({
  type: "text",
  text,
  ingestionPreview: true,
});

const toolResult = (output: unknown, state = "output-available") => ({
  type: "tool-webSearch",
  toolCallId: "call_1",
  state,
  input: {},
  output,
});

/** Thread long enough that the first message falls outside the kept turns. */
const thread = (first: UIMessage): UIMessage[] => [
  first,
  assistant([{ type: "text", text: "ok" }]),
  user([{ type: "text", text: "turn 2" }]),
  assistant([{ type: "text", text: "ok" }]),
  user([{ type: "text", text: "turn 3" }]),
];

describe("slimHistoryForModel", () => {
  it("truncates an oversized ingestion preview in an older turn", () => {
    const [firstMessage] = slimHistoryForModel(thread(user([preview(big())])));
    const part = firstMessage.parts[0] as any;

    expect(part.text.length).toBeLessThan(SLIM_MAX_PART_CHARS + 200);
    expect(part.text).toContain("characters omitted");
    expect(part.ingestionPreview).toBe(true);
  });

  it("truncates a settled oversized tool output in an older turn", () => {
    const messages = thread(user([{ type: "text", text: "search please" }]));
    messages[1] = assistant([toolResult({ results: big() })]);

    const part = slimHistoryForModel(messages)[1].parts[0] as any;

    expect(typeof part.output).toBe("string");
    expect(part.output).toContain("characters omitted");
  });

  it("leaves the recent turns untouched", () => {
    const recent = user([preview(big())]);
    const messages = [
      user([{ type: "text", text: "old" }]),
      assistant([{ type: "text", text: "ok" }]),
      user([{ type: "text", text: "turn 2" }]),
      recent,
    ];

    const result = slimHistoryForModel(messages);

    // Same object identity: the recent turn was not rewritten at all.
    expect(result[3]).toBe(recent);
    expect((result[3].parts[0] as any).text).toHaveLength(
      SLIM_MAX_PART_CHARS + 500,
    );
  });

  it("drops the duplicate raw file when a preview of it exists", () => {
    const messages = thread(
      user([
        preview("short preview"),
        { type: "file", url: "https://x/y.pdf", mediaType: "application/pdf" },
        { type: "file", url: "https://x/y.png", mediaType: "image/png" },
      ]),
    );

    const parts = slimHistoryForModel(messages)[0].parts as any[];

    expect(parts.map((p) => p.mediaType)).toEqual([undefined, "image/png"]);
  });

  it("does not rewrite an in-flight tool call", () => {
    const messages = thread(user([{ type: "text", text: "go" }]));
    const streaming = toolResult(undefined, "input-streaming");
    messages[1] = assistant([streaming]);

    expect(slimHistoryForModel(messages)[1].parts[0]).toBe(streaming);
  });

  it("is idempotent, so repeated requests serialize identically", () => {
    const messages = thread(user([preview(big())]));
    const once = slimHistoryForModel(messages);

    expect(JSON.stringify(slimHistoryForModel(once))).toBe(
      JSON.stringify(once),
    );
  });

  it("returns the original array when nothing needs slimming", () => {
    const messages = thread(user([{ type: "text", text: "hi" }]));
    expect(slimHistoryForModel(messages)).toBe(messages);
  });

  it("leaves short threads alone", () => {
    const messages = [user([preview(big())])];
    expect(slimHistoryForModel(messages)).toBe(messages);
  });
});
