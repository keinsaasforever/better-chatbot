import { describe, expect, test } from "vitest";
import {
  parseMessageMentions,
  truncateMessageMentions,
} from "./message-mentions";

describe("parseMessageMentions", () => {
  test("preserves plain text and whitespace", () => {
    const text = "Hello\n  world!";
    expect(parseMessageMentions(text)).toEqual([
      { type: "text", text, start: 0 },
    ]);
    expect(parseMessageMentions("")).toEqual([]);
  });

  test("separates a mention from the following prompt without requiring a space", () => {
    expect(parseMessageMentions('@agent("Research Agent")Find papers')).toEqual(
      [
        {
          type: "agent",
          name: "Research Agent",
          text: '@agent("Research Agent")',
          start: 0,
        },
        { type: "text", text: "Find papers", start: 24 },
      ],
    );
  });

  test("recognizes multiple and adjacent mentions, including app tool labels", () => {
    const parts = parseMessageMentions(
      'Use @tool(\'web-search\')@workflow("Daily Report") with @agent("Writer").',
    );
    expect(
      parts
        .filter((part) => part.type !== "text")
        .map((part) => [part.type, part.name]),
    ).toEqual([
      ["tool", "web-search"],
      ["workflow", "Daily Report"],
      ["agent", "Writer"],
    ]);
    expect(parts.map((part) => part.text).join("")).toBe(
      'Use @tool(\'web-search\')@workflow("Daily Report") with @agent("Writer").',
    );
  });

  test("keeps quotes and punctuation inside names", () => {
    const text = '@agent("Research "Pro" Agent") and @tool(\'Writer\'s tool\')';
    expect(
      parseMessageMentions(text)
        .filter((part) => part.type !== "text")
        .map((part) => part.name),
    ).toEqual(['Research "Pro" Agent', "Writer's tool"]);
  });

  test.each([
    '@agent("unfinished',
    "@tool(\"mismatched')",
    '@workflow("")',
    '@unknown("Other")',
    '@agent("line\nbreak")',
  ])("leaves unsupported or malformed text unchanged: %s", (text) => {
    expect(parseMessageMentions(text)).toEqual([
      { type: "text", text, start: 0 },
    ]);
  });

  test("does not share matcher state between calls", () => {
    const text = '@agent("Writer")';
    expect(parseMessageMentions(text)).toEqual(parseMessageMentions(text));
  });
});

describe("truncateMessageMentions", () => {
  test("retains the existing plain-text cutoff", () => {
    expect(truncateMessageMentions("short", 10)).toBe("short");
    expect(truncateMessageMentions("longer message", 6)).toBe("longer...");
  });

  test("does not expose a partial mention at the cutoff", () => {
    expect(
      truncateMessageMentions('Hi @agent("Research Agent") keep going', 12),
    ).toBe('Hi @agent("Research Agent")...');
  });
});
