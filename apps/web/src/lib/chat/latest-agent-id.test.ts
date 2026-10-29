import { describe, expect, test } from "vitest";
import { latestAgentIdFromMessages } from "./latest-agent-id";

const message = (agentId?: string) => ({
  metadata: agentId ? { agentId } : {},
});

describe("latestAgentIdFromMessages", () => {
  test("finds the agent of the most recent message that names one", () => {
    expect(
      latestAgentIdFromMessages([
        message("agent-1"),
        message(),
        message("agent-2"),
        message(),
      ]),
    ).toBe("agent-2");
  });

  test("returns undefined when no message names an agent", () => {
    expect(latestAgentIdFromMessages([message(), message()])).toBeUndefined();
  });

  test("handles an empty or missing history", () => {
    expect(latestAgentIdFromMessages([])).toBeUndefined();
    expect(latestAgentIdFromMessages(undefined)).toBeUndefined();
  });

  test("ignores messages with no metadata at all", () => {
    expect(
      latestAgentIdFromMessages([{}, { metadata: null }, message("agent-1")]),
    ).toBe("agent-1");
  });
});
