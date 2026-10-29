import { describe, expect, it } from "vitest";
import { buildVoiceWireSession } from "./realtime-session-config";
import {
  DEFAULT_VOICE_SETTINGS,
  checkSessionConfirmation,
  normalizeVoiceSettings,
} from "./voice-settings";

describe("normalizeVoiceSettings", () => {
  it("fills a missing store value with the defaults", () => {
    expect(normalizeVoiceSettings(undefined)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(normalizeVoiceSettings("corrupt")).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it("keeps valid values and clamps or replaces invalid ones", () => {
    expect(
      normalizeVoiceSettings({
        speed: 0.1,
        allowInterruptions: false,
        turnDetection: "server",
        threshold: 3,
        silenceDurationMs: 512.4,
        noiseReduction: "studio",
      }),
    ).toEqual({
      ...DEFAULT_VOICE_SETTINGS,
      speed: 0.25,
      allowInterruptions: false,
      turnDetection: "server",
      threshold: 1,
      silenceDurationMs: 512,
    });
  });
});

describe("checkSessionConfirmation", () => {
  const expected = buildVoiceWireSession({
    settings: DEFAULT_VOICE_SETTINGS,
    ptt: false,
  });

  it("confirms an echo that carries what was sent", () => {
    expect(
      checkSessionConfirmation(
        {
          session: {
            ...expected,
            audio: {
              ...expected.audio,
              output: { voice: "cedar", speed: 1.1, format: { type: "pcm" } },
            },
          },
        },
        expected,
      ),
    ).toEqual({ status: "confirmed" });
  });

  it("names every field the server did not take", () => {
    expect(
      checkSessionConfirmation(
        {
          session: {
            audio: {
              input: {
                noise_reduction: null,
                turn_detection: {
                  type: "semantic_vad",
                  eagerness: "auto",
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: { voice: "cedar", speed: 1 },
            },
          },
        },
        expected,
      ),
    ).toEqual({
      status: "mismatch",
      fields: [
        "audio.output.speed",
        "audio.input.noise_reduction",
        "audio.input.turn_detection.eagerness",
        "reasoning.effort",
      ],
    });
  });

  it("cannot vouch for anything when the echo has no session", () => {
    expect(
      checkSessionConfirmation({ type: "session-updated" }, expected),
    ).toEqual({ status: "unverifiable" });
  });
});
