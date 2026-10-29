import { describe, expect, it } from "vitest";
import { buildRealtimeSessionConfig } from "./realtime-session-config";
import { OPENAI_VOICE_PRESETS } from "./voice-constants";

describe("buildRealtimeSessionConfig", () => {
  it("speaks marin at 1.1x with the style section after the server prompt", () => {
    const config = buildRealtimeSessionConfig({
      voice: "marin",
      instructions: "Be helpful.",
    });

    expect(config.voice).toBe("marin");
    expect(config.providerOptions.audio.output).toEqual({
      voice: "marin",
      speed: 1.1,
    });
    expect(config.instructions).toMatch(/^Be helpful\.\n\n# Speaking style\n/);
    expect(config.instructions).not.toContain("JARVIS");
    expect(config.inputAudioTranscription.prompt).toMatch(
      /^Überwiegend Deutsch/,
    );
  });

  it("maps jarvis to cedar, English transcription and the persona after the style", () => {
    const config = buildRealtimeSessionConfig({
      voice: "jarvis",
      instructions: "Be helpful.",
    });

    expect(config.voice).toBe("cedar");
    expect(config.providerOptions.audio.output.voice).toBe("cedar");
    expect(config.inputAudioTranscription.prompt).toMatch(/^Mostly English/);
    const instructions = config.instructions ?? "";
    expect(instructions.startsWith("Be helpful.")).toBe(true);
    expect(instructions).toContain("JARVIS");
    expect(instructions.indexOf("# Speaking style")).toBeLessThan(
      instructions.indexOf("# Personality"),
    );
  });

  // The server prompt carries the one language rule; a second one here is
  // what made answers flip between languages.
  it("adds no language rule of its own", () => {
    for (const preset of OPENAI_VOICE_PRESETS) {
      const instructions =
        buildRealtimeSessionConfig({ voice: preset.id, instructions: "x" })
          .instructions ?? "";
      expect(instructions).not.toMatch(/by default|standardmäßig/i);
    }
  });

  it("falls back to the jarvis default for a persisted voice no longer offered", () => {
    const config = buildRealtimeSessionConfig({ voice: "ash" });

    expect(config.voice).toBe("cedar");
    expect(config.providerOptions.audio.output.voice).toBe("cedar");
  });

  it("sends no instructions before the server prompt is prepared", () => {
    const config = buildRealtimeSessionConfig({ voice: "jarvis" });

    expect(config).not.toHaveProperty("instructions");
  });

  it("defaults to semantic VAD at medium eagerness with barge-in and low reasoning", () => {
    const config = buildRealtimeSessionConfig({ voice: "jarvis" });

    expect(config.turnDetection).toEqual({ type: "semantic-vad" });
    expect(config.providerOptions.audio.input.turn_detection).toEqual({
      type: "semantic_vad",
      eagerness: "medium",
      create_response: true,
      interrupt_response: true,
    });
    expect(config.providerOptions.reasoning).toEqual({ effort: "low" });
  });

  it("maps server VAD details to both layers and honours interruptions off", () => {
    const config = buildRealtimeSessionConfig({
      voice: "marin",
      settings: {
        turnDetection: "server",
        silenceDurationMs: 700,
        threshold: 0.7,
        prefixPaddingMs: 100,
        allowInterruptions: false,
        noiseReduction: "off",
      },
    });

    expect(config.turnDetection).toEqual({
      type: "server-vad",
      threshold: 0.7,
      silenceDurationMs: 700,
      prefixPaddingMs: 100,
    });
    expect(config.providerOptions.audio.input.turn_detection).toEqual({
      type: "server_vad",
      threshold: 0.7,
      silence_duration_ms: 700,
      prefix_padding_ms: 100,
      create_response: true,
      interrupt_response: false,
    });
    expect(config.providerOptions.audio.input.noise_reduction).toBeNull();
  });

  it("validates settings before they reach the wire", () => {
    const config = buildRealtimeSessionConfig({
      voice: "marin",
      settings: { speed: 9, turnDetection: "shout", eagerness: "now" },
    });

    expect(config.providerOptions.audio.output.speed).toBe(1.5);
    expect(config.providerOptions.audio.input.turn_detection).toEqual(
      expect.objectContaining({ type: "semantic_vad", eagerness: "medium" }),
    );
  });

  it("turns detection off entirely in push-to-talk mode", () => {
    const config = buildRealtimeSessionConfig({ voice: "marin", ptt: true });

    expect(config.turnDetection).toEqual({ type: "disabled" });
    expect(config.providerOptions.audio.input.turn_detection).toBeNull();
  });

  it("offers at most four voices, all on the realtime-recommended wire voices", () => {
    expect(OPENAI_VOICE_PRESETS.length).toBeLessThanOrEqual(4);
    for (const preset of OPENAI_VOICE_PRESETS) {
      expect(["marin", "cedar"]).toContain(preset.voice);
    }
  });
});
