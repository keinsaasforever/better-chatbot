import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildAnsweredInChatOutput,
  extractSendMessageText,
  findPendingToolCall,
} from "./pending-tool-call";

const planCall = (state: string, extra: Record<string, unknown> = {}) =>
  ({
    type: "tool-askForPlanApproval",
    toolCallId: "call_1",
    state,
    input: { todos: [] },
    ...extra,
  }) as unknown as UIMessage["parts"][number];

const assistantWith = (part: UIMessage["parts"][number]): UIMessage[] => [
  { id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] },
  { id: "m2", role: "assistant", parts: [{ type: "step-start" }, part] },
];

describe("findPendingToolCall", () => {
  it("finds a tool call that is still waiting on the UI", () => {
    expect(
      findPendingToolCall(assistantWith(planCall("input-available")), "ready"),
    ).toEqual({ toolName: "askForPlanApproval", toolCallId: "call_1" });
  });

  it("ignores a tool call that already produced output", () => {
    expect(
      findPendingToolCall(
        assistantWith(planCall("output-available", { output: { ok: true } })),
        "ready",
      ),
    ).toBeNull();
  });

  it("ignores a still-streaming run", () => {
    expect(
      findPendingToolCall(
        assistantWith(planCall("input-available")),
        "streaming",
      ),
    ).toBeNull();
  });
});

describe("extractSendMessageText", () => {
  it("joins the user's text parts", () => {
    expect(
      extractSendMessageText({
        role: "user",
        parts: [
          {
            type: "file",
            url: "https://x/y.pdf",
            mediaType: "application/pdf",
          },
          { type: "text", text: "  Do it differently: start with Gmail  " },
        ],
      } as Parameters<typeof extractSendMessageText>[0]),
    ).toBe("Do it differently: start with Gmail");
  });

  it("skips the attachment summary preview part", () => {
    expect(
      extractSendMessageText({
        role: "user",
        parts: [
          {
            type: "text",
            text: "Attached files:\n1. a.pdf",
            ingestionPreview: true,
          },
          { type: "text", text: "check this" },
        ],
      } as Parameters<typeof extractSendMessageText>[0]),
    ).toBe("check this");
  });

  it("returns an empty string when there is no text", () => {
    expect(
      extractSendMessageText(
        undefined as unknown as Parameters<typeof extractSendMessageText>[0],
      ),
    ).toBe("");
  });
});

describe("buildAnsweredInChatOutput", () => {
  it("marks the call as unapproved and carries the user's words", () => {
    const output = buildAnsweredInChatOutput("use Revolut instead");
    expect(output.approved).toBe(false);
    expect(output.rejected).toBe(true);
    expect(output.answeredInChat).toBe(true);
    expect(output.userMessage).toBe("use Revolut instead");
  });
});
