import { describe, expect, test } from "vitest";
import { getVoiceSessionPolicy } from "./voice-session-policy";

describe("getVoiceSessionPolicy", () => {
  test("uses short command guardrails for voice_command", () => {
    const policy = getVoiceSessionPolicy("voice_command");

    expect(policy.mode).toBe("voice_command");
    expect(policy.allowToolExecution).toBe(true);
    expect(policy.ttsResponseEnabled).toBe(true);
    expect(policy.autoEndSilenceMs).toBeGreaterThan(0);
    expect(policy.maxDurationMs).toBe(2 * 60 * 1000);
  });

  test("uses two hour guardrail and disables tools for long_capture", () => {
    const policy = getVoiceSessionPolicy("long_capture");

    expect(policy.mode).toBe("long_capture");
    expect(policy.allowToolExecution).toBe(false);
    expect(policy.ttsResponseEnabled).toBe(false);
    expect(policy.autoEndSilenceMs).toBeNull();
    expect(policy.maxDurationMs).toBe(2 * 60 * 60 * 1000);
  });
});
