/**
 * User-tunable realtime voice settings: speaking speed, interruptions and
 * end-of-turn detection.
 *
 * Every value here ends up in the OpenAI `session.update` (see
 * realtime-session-config.ts), so whatever the store holds is validated by
 * `normalizeVoiceSettings` before it is sent: a hand-edited or stale persisted
 * value must never reach the wire as something the API rejects, because a
 * rejected `session.update` leaves the session on its defaults (no
 * instructions, no tools).
 */

export type VoiceTurnDetectionMode = "semantic" | "server";
export type VoiceEagerness = "low" | "medium" | "high" | "auto";
export type VoiceNoiseReduction = "near_field" | "far_field" | "off";

export type VoiceSettings = {
  /** Output playback rate, OpenAI range 0.25 to 1.5. */
  speed: number;
  /**
   * Barge-in. On: the mic stays open while the assistant speaks, new speech
   * cancels the response (`interrupt_response`) and the SDK drops the queued
   * audio and truncates the unheard rest. Off: the mic pauses while the
   * assistant speaks, which is also the echo-safe mode for loudspeakers.
   */
  allowInterruptions: boolean;
  turnDetection: VoiceTurnDetectionMode;
  /** Semantic VAD only. */
  eagerness: VoiceEagerness;
  /** Server VAD only. */
  silenceDurationMs: number;
  /** Server VAD only, 0 to 1. */
  threshold: number;
  /** Server VAD only. */
  prefixPaddingMs: number;
  noiseReduction: VoiceNoiseReduction;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  speed: 1.1,
  allowInterruptions: true,
  turnDetection: "semantic",
  eagerness: "medium",
  silenceDurationMs: 500,
  threshold: 0.5,
  prefixPaddingMs: 300,
  noiseReduction: "near_field",
};

/**
 * Discrete steps the drawer offers. Steps rather than free sliders: each one is
 * a value worth hearing the difference of, and the extremes OpenAI allows
 * (0.25x speech, 3 s of silence) are not useful in a conversation.
 */
export const VOICE_SPEED_OPTIONS = [0.9, 1, 1.1, 1.2, 1.3, 1.4, 1.5] as const;
export const VOICE_EAGERNESS_OPTIONS: readonly VoiceEagerness[] = [
  "low",
  "medium",
  "high",
  "auto",
];
export const VOICE_SILENCE_DURATION_OPTIONS_MS = [300, 500, 700, 1000] as const;
export const VOICE_THRESHOLD_OPTIONS = [0.3, 0.5, 0.7, 0.9] as const;
export const VOICE_PREFIX_PADDING_OPTIONS_MS = [100, 300, 500] as const;
export const VOICE_NOISE_REDUCTION_OPTIONS: readonly VoiceNoiseReduction[] = [
  "near_field",
  "far_field",
  "off",
];

/** OpenAI's documented speed range for realtime audio output. */
const SPEED_MIN = 0.25;
const SPEED_MAX = 1.5;

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** Store value (possibly partial, stale or hand-edited) → a sendable setting. */
export function normalizeVoiceSettings(raw: unknown): VoiceSettings {
  const input =
    typeof raw === "object" && raw !== null
      ? (raw as Partial<Record<keyof VoiceSettings, unknown>>)
      : {};
  const d = DEFAULT_VOICE_SETTINGS;
  return {
    speed: clampNumber(input.speed, SPEED_MIN, SPEED_MAX, d.speed),
    allowInterruptions:
      typeof input.allowInterruptions === "boolean"
        ? input.allowInterruptions
        : d.allowInterruptions,
    turnDetection: pick(
      input.turnDetection,
      ["semantic", "server"],
      d.turnDetection,
    ),
    eagerness: pick(input.eagerness, VOICE_EAGERNESS_OPTIONS, d.eagerness),
    silenceDurationMs: Math.round(
      clampNumber(input.silenceDurationMs, 100, 3000, d.silenceDurationMs),
    ),
    threshold: clampNumber(input.threshold, 0, 1, d.threshold),
    prefixPaddingMs: Math.round(
      clampNumber(input.prefixPaddingMs, 0, 2000, d.prefixPaddingMs),
    ),
    noiseReduction: pick(
      input.noiseReduction,
      VOICE_NOISE_REDUCTION_OPTIONS,
      d.noiseReduction,
    ),
  };
}

/**
 * What the server confirmed in `session.updated`, compared with what was sent.
 *
 * `unverifiable` means the event arrived without the provider's session echo
 * (the gateway may normalize it away); that is not a failure, only a setting
 * nobody can vouch for from the client.
 */
export type VoiceSessionConfirmation =
  | { status: "pending" }
  | { status: "unverifiable" }
  | { status: "confirmed" }
  | { status: "mismatch"; fields: string[] };

type WireSession = {
  audio?: {
    input?: {
      noise_reduction?: { type?: string } | null;
      turn_detection?: Record<string, unknown> | null;
    };
    output?: { voice?: string; speed?: number };
  };
  reasoning?: { effort?: string };
};

/**
 * Compare the `session` the provider echoed in `session.updated` with the wire
 * fields we asked for. Only fields we set are checked; the echo carries many
 * more defaults that are none of our business.
 */
export function checkSessionConfirmation(
  rawEvent: unknown,
  expected: WireSession,
): VoiceSessionConfirmation {
  const session = (rawEvent as { session?: WireSession } | null)?.session;
  if (!session || typeof session !== "object") {
    return { status: "unverifiable" };
  }

  const fields: string[] = [];
  const expectOutput = expected.audio?.output;
  const gotOutput = session.audio?.output;
  if (expectOutput?.voice != null && gotOutput?.voice !== expectOutput.voice) {
    fields.push("audio.output.voice");
  }
  if (
    expectOutput?.speed != null &&
    (typeof gotOutput?.speed !== "number" ||
      Math.abs(gotOutput.speed - expectOutput.speed) > 0.001)
  ) {
    fields.push("audio.output.speed");
  }

  const expectInput = expected.audio?.input;
  if (expectInput && "noise_reduction" in expectInput) {
    const want = expectInput.noise_reduction?.type ?? null;
    const got = session.audio?.input?.noise_reduction?.type ?? null;
    if (want !== got) fields.push("audio.input.noise_reduction");
  }
  if (expectInput && "turn_detection" in expectInput) {
    const want = expectInput.turn_detection ?? null;
    const got = session.audio?.input?.turn_detection ?? null;
    if (want === null || got === null) {
      if (want !== got) fields.push("audio.input.turn_detection");
    } else {
      for (const [key, value] of Object.entries(want)) {
        if (got[key] !== value) {
          fields.push(`audio.input.turn_detection.${key}`);
        }
      }
    }
  }

  if (
    expected.reasoning?.effort != null &&
    session.reasoning?.effort !== expected.reasoning.effort
  ) {
    fields.push("reasoning.effort");
  }

  return fields.length > 0
    ? { status: "mismatch", fields }
    : { status: "confirmed" };
}
