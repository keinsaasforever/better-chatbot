export const ASSEMBLYAI_EU_STREAMING_WS_URL =
  "wss://streaming.eu.assemblyai.com/v3/ws";

export const ASSEMBLYAI_STREAMING_SAMPLE_RATE = 16_000;

export const DEFAULT_ASSEMBLYAI_STREAMING_MODEL = "universal-3-6-pro";

/** Bias German recognition; not a hard language lock. */
export const DEFAULT_ASSEMBLYAI_STREAMING_LANGUAGE = "de";

/**
 * Turn endpointing (Universal-3.6 Pro / U3 Pro Streaming semantics).
 *
 * A turn only reaches us once AssemblyAI declares end-of-turn, so these two
 * knobs are what the user perceives as "how long until my text shows up".
 *
 * - `min_turn_silence`: silence before a *speculative* end-of-turn check. If
 *   the model finds terminal punctuation (. ? !) the turn ends immediately;
 *   otherwise it emits a partial and keeps listening. AssemblyAI's default is
 *   100 ms. We pin it so a server-side default change cannot silently add
 *   latency. Raising it (e.g. 400 ms) makes dictation of numbers/emails safer
 *   but adds that much delay to every finalized turn.
 * - `max_turn_silence`: hard cap — the turn is forced to end after this much
 *   silence even without terminal punctuation. AssemblyAI's default is 1000 ms,
 *   and this is the branch that actually feels slow, because dictated German
 *   fragments often never get sentence-final punctuation. We lower it to
 *   700 ms.
 *
 * Tradeoff: lowering these produces faster transcripts but can split a single
 * utterance (or an entity like a phone number) across turns for slow speakers.
 * Do not push `max_turn_silence` far below `min_turn_silence` + ~250 ms.
 */
export const ASSEMBLYAI_MIN_TURN_SILENCE_MS = 100;

export const ASSEMBLYAI_MAX_TURN_SILENCE_MS = 700;

export const ASSEMBLYAI_DICTATION_KEYTERMS = [
  "senden",
  "abschicken",
  "nachricht",
  "Keinsaas",
  "Navigator",
  "Workflow",
  "Agent",
  "Projekt",
] as const;

export function getAssemblyAIStreamingModel(): string {
  const configured = process.env.NEXT_PUBLIC_ASSEMBLYAI_STREAMING_MODEL?.trim();
  return configured || DEFAULT_ASSEMBLYAI_STREAMING_MODEL;
}

/** Parse a positive-integer millisecond override; ignore anything malformed. */
function readMsOverride(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw?.trim() ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAssemblyAIMinTurnSilenceMs(): number {
  return readMsOverride(
    process.env.NEXT_PUBLIC_ASSEMBLYAI_MIN_TURN_SILENCE_MS,
    ASSEMBLYAI_MIN_TURN_SILENCE_MS,
  );
}

export function getAssemblyAIMaxTurnSilenceMs(): number {
  return readMsOverride(
    process.env.NEXT_PUBLIC_ASSEMBLYAI_MAX_TURN_SILENCE_MS,
    ASSEMBLYAI_MAX_TURN_SILENCE_MS,
  );
}

export type AssemblyAIStreamingConnectionParams = {
  token: string;
  speechModel?: string;
  languageCode?: string;
  keyterms?: readonly string[];
  sampleRate?: number;
  minTurnSilenceMs?: number;
  maxTurnSilenceMs?: number;
};

export function buildAssemblyAIStreamingUrl({
  token,
  speechModel = getAssemblyAIStreamingModel(),
  languageCode = DEFAULT_ASSEMBLYAI_STREAMING_LANGUAGE,
  keyterms = ASSEMBLYAI_DICTATION_KEYTERMS,
  sampleRate = ASSEMBLYAI_STREAMING_SAMPLE_RATE,
  minTurnSilenceMs = getAssemblyAIMinTurnSilenceMs(),
  maxTurnSilenceMs = getAssemblyAIMaxTurnSilenceMs(),
}: AssemblyAIStreamingConnectionParams): string {
  const params = new URLSearchParams({
    speech_model: speechModel,
    sample_rate: String(sampleRate),
    encoding: "pcm_s16le",
    language_code: languageCode,
    keyterms_prompt: JSON.stringify([...keyterms]),
    // See ASSEMBLYAI_MIN/MAX_TURN_SILENCE_MS above for the latency tradeoff.
    // `format_turns` is deliberately absent: U3 Pro always formats turns. So
    // are the deprecated `end_of_turn_confidence_threshold` and
    // `min_end_of_turn_silence_when_confident` (Universal-Streaming only).
    min_turn_silence: String(minTurnSilenceMs),
    max_turn_silence: String(maxTurnSilenceMs),
    token,
  });

  return `${ASSEMBLYAI_EU_STREAMING_WS_URL}?${params.toString()}`;
}

export function convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

export function resampleFloat32ToTargetRate(
  input: Float32Array,
  inputRate: number,
  targetRate: number,
): Float32Array {
  if (inputRate === targetRate || input.length === 0) {
    return input;
  }

  const ratio = inputRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[idx + 1] ?? s0;
    output[i] = s0 + (s1 - s0) * frac;
  }

  return output;
}

export function preparePcmChunkForAssemblyAI(
  float32Audio: Float32Array,
  inputSampleRate: number,
  targetSampleRate = ASSEMBLYAI_STREAMING_SAMPLE_RATE,
): ArrayBuffer {
  const resampled = resampleFloat32ToTargetRate(
    float32Audio,
    inputSampleRate,
    targetSampleRate,
  );
  return convertFloat32ToInt16(resampled).buffer as ArrayBuffer;
}
