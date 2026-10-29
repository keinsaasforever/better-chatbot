import {
  VOICE_TRANSCRIPTION_MODEL,
  getVoiceTranscriptionPrompt,
} from "lib/ai/speech/voice-realtime-config";
import type { OpenAIRealtimeFunctionTool } from "lib/voice/openai-tools";
import {
  type OpenAIVoicePreset,
  VOICE_REASONING_EFFORT,
  VOICE_STYLE_INSTRUCTIONS,
  resolveOpenAIVoicePreset,
} from "./voice-constants";
import { type VoiceSettings, normalizeVoiceSettings } from "./voice-settings";

/**
 * The realtime session config the voice hook sends in its `session-update`.
 *
 * Two layers, on purpose:
 *
 * 1. The AI SDK's normalized fields (`turnDetection`, `inputAudioTranscription`,
 *    `voice`). The SDK types (`RealtimeModelV4SessionConfig`) know server and
 *    semantic VAD, the server-VAD details and a transcription model + prompt,
 *    but have no field for VAD eagerness, `interrupt_response`,
 *    `create_response`, input noise reduction, output speed or reasoning.
 * 2. `providerOptions`, which the OpenAI realtime mapping merges into the wire
 *    `session` object (`Object.assign(session, providerOptions)` in
 *    `buildOpenAISessionConfig`, checked in @ai-sdk/openai 4.0.91). The merge
 *    is shallow, so the whole `audio` block is restated there in wire format
 *    with the extra fields added; restating rather than patching keeps both
 *    layers saying the same thing.
 *
 * If the gateway ever drops `providerOptions`, layer 1 still applies on its
 * own: the chosen VAD mode with its normalized details, the better
 * transcriber, no noise reduction, normal playback speed. The hook checks the
 * server's `session.updated` echo to tell which of these actually stuck.
 *
 * `voice` is a preset id from the drawer (see OPENAI_VOICE_PRESETS): it
 * resolves to the wire voice, and the style section plus the preset's persona
 * are appended to the server-built instructions.
 */
export type RealtimeSessionConfigInput = {
  voice: string;
  /** Raw store value; validated here before anything is sent. */
  settings?: unknown;
  instructions?: string;
  tools?: OpenAIRealtimeFunctionTool[];
  /**
   * Push-to-talk: no turn detection at all. The caller commits the input
   * buffer and requests a response itself when the talk button is released.
   */
  ptt?: boolean;
};

/**
 * The wire `turn_detection`. Both automatic flags stay on: the model answers
 * on its own after a turn, and `interrupt_response` follows the barge-in
 * setting. Fields of the other VAD mode are left out, not nulled.
 */
function buildWireTurnDetection(settings: VoiceSettings, ptt: boolean) {
  if (ptt) return null;
  if (settings.turnDetection === "server") {
    return {
      type: "server_vad",
      threshold: settings.threshold,
      silence_duration_ms: settings.silenceDurationMs,
      prefix_padding_ms: settings.prefixPaddingMs,
      create_response: true,
      interrupt_response: settings.allowInterruptions,
    };
  }
  return {
    type: "semantic_vad",
    eagerness: settings.eagerness,
    create_response: true,
    interrupt_response: settings.allowInterruptions,
  };
}

/**
 * The provider-specific part of the session, in OpenAI wire format.
 *
 * `voice` is optional because a live update must not carry it: OpenAI refuses
 * a voice change once the model has spoken, and `session.update` only touches
 * the fields that are present, so leaving it out keeps the current voice.
 */
export function buildVoiceWireSession(input: {
  preset?: OpenAIVoicePreset;
  settings: VoiceSettings;
  ptt: boolean;
}) {
  const { preset, settings, ptt } = input;
  return {
    audio: {
      input: {
        noise_reduction:
          settings.noiseReduction === "off"
            ? null
            : { type: settings.noiseReduction },
        turn_detection: buildWireTurnDetection(settings, ptt),
      },
      output: {
        ...(preset ? { voice: preset.voice } : {}),
        speed: settings.speed,
      },
    },
    reasoning: { effort: VOICE_REASONING_EFFORT },
  };
}

export function buildRealtimeSessionConfig(input: RealtimeSessionConfigInput) {
  const preset = resolveOpenAIVoicePreset(input.voice);
  const transcription = {
    model: VOICE_TRANSCRIPTION_MODEL,
    prompt: getVoiceTranscriptionPrompt(preset.language),
  };
  const settings = normalizeVoiceSettings(input.settings);
  const ptt = input.ptt === true;
  // The style sections ride on the server prompt. Without one (nothing
  // prepared yet) the key stays absent, as before.
  const instructions = input.instructions
    ? [input.instructions, VOICE_STYLE_INSTRUCTIONS, preset.persona]
        .filter(Boolean)
        .join("\n\n")
    : undefined;
  const wire = buildVoiceWireSession({ preset, settings, ptt });

  return {
    voice: preset.voice,
    inputAudioTranscription: transcription,
    turnDetection: ptt
      ? ({ type: "disabled" } as const)
      : settings.turnDetection === "server"
        ? ({
            type: "server-vad",
            threshold: settings.threshold,
            silenceDurationMs: settings.silenceDurationMs,
            prefixPaddingMs: settings.prefixPaddingMs,
          } as const)
        : ({ type: "semantic-vad" } as const),
    providerOptions: {
      ...wire,
      audio: {
        ...wire.audio,
        input: { transcription, ...wire.audio.input },
      },
    },
    ...(instructions ? { instructions } : {}),
    ...(input.tools ? { tools: input.tools } : {}),
  };
}
