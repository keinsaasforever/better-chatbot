import { describe, expect, it } from "vitest";
import { BLOCKED_TOOL_NAME, readBlockedReason } from "./blocked-signal";

const PART = `tool-${BLOCKED_TOOL_NAME}`;

describe("readBlockedReason", () => {
  it("returns null when the run finished normally", () => {
    expect(
      readBlockedReason([
        { type: "tool-playwright_execute" },
        { type: "text" },
      ]),
    ).toBeNull();
  });

  it("reads the reason off a blocked call", () => {
    expect(
      readBlockedReason([
        { type: "tool-playwright_execute" },
        {
          type: PART,
          input: { reason: "The sign-in page wants a Smart-ID confirmation." },
        } as never,
      ]),
    ).toBe("The sign-in page wants a Smart-ID confirmation.");
  });

  it("keeps the newest of two reports", () => {
    expect(
      readBlockedReason([
        { type: PART, input: { reason: "first" } } as never,
        { type: PART, input: { reason: "second" } } as never,
      ]),
    ).toBe("second");
  });

  // A malformed report still means the run stopped. Treating it as "no report"
  // would record the run as a success, which is the bug this whole signal
  // exists to prevent.
  it("still reports a block when the reason is missing or blank", () => {
    expect(readBlockedReason([{ type: PART } as never])).toBeTruthy();
    expect(
      readBlockedReason([{ type: PART, input: { reason: "  " } } as never]),
    ).toBeTruthy();
    expect(
      readBlockedReason([{ type: PART, input: { reason: 42 } } as never]),
    ).toBeTruthy();
  });
});
