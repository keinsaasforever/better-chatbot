import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadAiTelemetry = async () => {
  vi.resetModules();
  const { aiTelemetry } = await import("./telemetry");
  return aiTelemetry;
};

describe("aiTelemetry", () => {
  const originalFlag = process.env.SUPERLOG_RECORD_AI_CONTENT;

  beforeEach(() => {
    delete process.env.SUPERLOG_RECORD_AI_CONTENT;
  });

  afterEach(() => {
    if (originalFlag === undefined) {
      delete process.env.SUPERLOG_RECORD_AI_CONTENT;
    } else {
      process.env.SUPERLOG_RECORD_AI_CONTENT = originalFlag;
    }
  });

  it("enables telemetry but withholds prompt and completion content by default", async () => {
    const aiTelemetry = await loadAiTelemetry();

    const settings = aiTelemetry("chat.stream");

    expect(settings.isEnabled).toBe(true);
    expect(settings.functionId).toBe("chat.stream");
    // The guardrail: chat text must not leave for a US-hosted intake unless
    // someone deliberately opts in.
    expect(settings.recordInputs).toBe(false);
    expect(settings.recordOutputs).toBe(false);
  });

  it("records content only when the opt-in flag is set", async () => {
    process.env.SUPERLOG_RECORD_AI_CONTENT = "1";
    const aiTelemetry = await loadAiTelemetry();

    const settings = aiTelemetry("chat.stream");

    expect(settings.recordInputs).toBe(true);
    expect(settings.recordOutputs).toBe(true);
  });

  it('treats any value other than "1" as opted out', async () => {
    process.env.SUPERLOG_RECORD_AI_CONTENT = "true";
    const aiTelemetry = await loadAiTelemetry();

    expect(aiTelemetry("chat.stream").recordInputs).toBe(false);
  });

  it("drops nullish metadata so optional values can be passed inline", async () => {
    const aiTelemetry = await loadAiTelemetry();

    const settings = aiTelemetry("chat.stream", {
      organizationId: "org_1",
      agentId: undefined,
      threadId: null,
      toolCount: 0,
      isTemporary: false,
    });

    // Falsy-but-present values must survive; only null/undefined are dropped.
    expect(settings.metadata).toEqual({
      organizationId: "org_1",
      toolCount: 0,
      isTemporary: false,
    });
  });

  it("omits metadata entirely when every value is nullish", async () => {
    const aiTelemetry = await loadAiTelemetry();

    expect(
      aiTelemetry("chat.stream", { agentId: undefined }).metadata,
    ).toBeUndefined();
  });
});
