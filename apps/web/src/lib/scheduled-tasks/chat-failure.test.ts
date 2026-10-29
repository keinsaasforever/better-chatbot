import { describe, expect, it } from "vitest";
import {
  isFailedRunFinishReason,
  isTransientChatFailure,
  readStreamFinishReason,
  readStreamOutcome,
} from "./chat-failure";

describe("isTransientChatFailure", () => {
  it("treats timeouts, rate limits, and server errors as transient", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      expect(isTransientChatFailure(status)).toBe(true);
    }
  });

  it("treats other client errors as permanent", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isTransientChatFailure(status)).toBe(false);
    }
  });
});

const frame = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\n\n`;

describe("readStreamFinishReason", () => {
  it("reads the finish chunk's own finishReason", () => {
    const sse =
      frame({ type: "start" }) +
      frame({ type: "text-delta", delta: "hi" }) +
      frame({ type: "finish", finishReason: "stop" }) +
      "data: [DONE]\n\n";

    expect(readStreamFinishReason(sse)).toBe("stop");
  });

  it("ignores finish-step chunks", () => {
    const sse =
      frame({ type: "finish-step", finishReason: "tool-calls" }) +
      frame({ type: "finish", finishReason: "stop" });

    expect(readStreamFinishReason(sse)).toBe("stop");
  });

  it("returns undefined when the stream never finished", () => {
    expect(readStreamFinishReason(frame({ type: "start" }))).toBeUndefined();
    expect(readStreamFinishReason("data: ok\n\n")).toBeUndefined();
    expect(readStreamFinishReason("")).toBeUndefined();
  });

  it("survives a frame split mid-JSON by the tail window", () => {
    const complete = frame({ type: "finish", finishReason: "stop" });
    expect(readStreamFinishReason(`{"type":"text-de` + "\n" + complete)).toBe(
      "stop",
    );
  });
});

describe("isFailedRunFinishReason", () => {
  it("fails a run that stopped on an unanswered tool call", () => {
    // The incident: a client-side tool called on a run with no browser.
    expect(isFailedRunFinishReason("tool-calls")).toBe(true);
  });

  it("fails errored, truncated, filtered, and unfinished runs", () => {
    for (const reason of ["error", "length", "content-filter", undefined]) {
      expect(isFailedRunFinishReason(reason)).toBe(true);
    }
  });

  it("passes a run that finished normally", () => {
    expect(isFailedRunFinishReason("stop")).toBe(false);
  });
});

describe("readStreamOutcome", () => {
  it("reads a blocked reason off the finish frame's metadata", () => {
    const sse = `data: ${JSON.stringify({
      type: "finish",
      finishReason: "stop",
      messageMetadata: {
        blocked: { source: "browser-automation", reason: "needs Smart-ID" },
      },
    })}\n\n`;
    expect(readStreamOutcome(sse)).toEqual({
      finishReason: "stop",
      blockedReason: "needs Smart-ID",
    });
  });

  it("leaves the blocked reason undefined on a normal run", () => {
    const sse = `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\n`;
    expect(readStreamOutcome(sse).blockedReason).toBeUndefined();
  });

  it("ignores a blank blocked reason", () => {
    const sse = `data: ${JSON.stringify({
      type: "finish",
      finishReason: "stop",
      messageMetadata: { blocked: { source: "x", reason: "  " } },
    })}\n\n`;
    expect(readStreamOutcome(sse).blockedReason).toBeUndefined();
  });

  /**
   * A blocked run genuinely finishes with `stop`. Widening the failed-reason
   * set to catch it would start failing healthy runs, so the two signals stay
   * separate and the caller checks both.
   */
  it("does not turn a blocked run into a failed finish reason", () => {
    expect(isFailedRunFinishReason("stop")).toBe(false);
  });
});
