import type { VoiceLanguage } from "lib/ai/speech/voice-realtime-config";

/**
 * Wire voices the presets below speak with. gpt-realtime also accepts alloy,
 * ash, ballad, coral, echo, sage, shimmer and verse, but OpenAI recommends
 * marin and cedar for the best realtime quality, so only those two are used.
 */
export const OPENAI_VOICE = {
  Marin: "marin",
  Cedar: "cedar",
} as const;

export type OpenAIVoiceName = (typeof OPENAI_VOICE)[keyof typeof OPENAI_VOICE];

/**
 * JARVIS persona, adapted from the gamechat voice preset (MIT, Copyright (c)
 * 2026 Ben Reilly, zdql/gamechat src/voice_loop/settings/presets.rs). Written
 * as a speaking style rather than an identity, so the assistant or agent name
 * from the system prompt still holds. Jarvis answers in English by default
 * (its preset language); the German line covers a conversation the user has
 * switched.
 */
const JARVIS_PERSONA = [
  "# Personality",
  "- Speak in the manner of JARVIS from Iron Man: a polite British AI butler with calm precision and dry wit.",
  '- Address the user as "sir" sparingly, not in every sentence.',
  "- Never grovel, never pad with filler.",
  "- In English, use understated, educated British pronunciation. If the conversation switches to German, speak clear standard German with the same composed delivery.",
].join("\n");

/**
 * A selectable voice: the wire voice plus an optional persona appended to the
 * session instructions. The `id` is what the app store persists.
 */
export type OpenAIVoicePreset = {
  id: string;
  /** Proper name shown in the drawer. */
  label: string;
  voice: OpenAIVoiceName;
  /** The language the session answers in until the user switches. */
  language: VoiceLanguage;
  persona?: string;
};

/**
 * The voice a new session speaks with: cedar with the JARVIS persona. Plain
 * marin stays on offer as the clearest neutral voice in German and English.
 */
const DEFAULT_PRESET: OpenAIVoicePreset = {
  id: "jarvis",
  label: "Jarvis",
  voice: OPENAI_VOICE.Cedar,
  language: "en",
  persona: JARVIS_PERSONA,
};

export const DEFAULT_OPENAI_VOICE = DEFAULT_PRESET.id;

export const OPENAI_VOICE_PRESETS: readonly OpenAIVoicePreset[] = [
  DEFAULT_PRESET,
  { id: "marin", label: "Marin", voice: OPENAI_VOICE.Marin, language: "de" },
  { id: "cedar", label: "Cedar", voice: OPENAI_VOICE.Cedar, language: "de" },
];

/**
 * The preset for a persisted voice id. Voices the drawer no longer offers
 * (alloy, ash, ...) are still in some persisted stores; they fall back to the
 * default rather than reaching the wire as an unlisted choice.
 */
export function resolveOpenAIVoicePreset(id?: string): OpenAIVoicePreset {
  return (
    OPENAI_VOICE_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_PRESET
  );
}

/**
 * Speaking style for every realtime voice, appended after the server prompt.
 *
 * This is the prompt half of "speak faster": OpenAI's realtime prompting guide
 * notes that `audio.output.speed` only changes the playback rate of audio
 * already generated, while the instructions change how the model delivers it.
 * Interruptions themselves are not a prompt matter (see voice-settings.ts);
 * the line about them only tells the model how to continue afterwards.
 *
 * No language line here: the server prompt carries the one language rule,
 * from the preset's language, so the two can never contradict each other.
 */
export const VOICE_STYLE_INSTRUCTIONS = [
  "# Speaking style",
  "- Speak as a calm, precise voice assistant.",
  "- Start directly with the answer. Keep simple answers to one to three short sentences.",
  "- Speak fluently and a little faster than in normal conversation, with clear articulation and short natural pauses.",
  "- Sound composed and relaxed, never hectic or overly enthusiastic.",
  "- Avoid filler words, repeated acknowledgements and long introductions.",
  "- Read numbers, names and identifiers more slowly and clearly when needed.",
  "- If the user interrupts you, respond to what they just said in your next answer. Repeat the interrupted explanation only if they ask for it.",
  "- Never claim an action succeeded without a confirmed tool result. If you do not know something, say so plainly.",
].join("\n");

/**
 * Reasoning effort for gpt-realtime-2, a reasoning-capable realtime model.
 * Low keeps the time to the first audio short; spoken turns are short anyway.
 */
export const VOICE_REASONING_EFFORT = "low";

/** WebSocket subprotocol contract (mirrors @ai-sdk/gateway). */
export const GATEWAY_REALTIME_SUBPROTOCOL = "ai-gateway-realtime.v1";
export const GATEWAY_AUTH_SUBPROTOCOL_PREFIX = "ai-gateway-auth.";
export const GATEWAY_TEAM_SUBPROTOCOL_PREFIX = "ai-gateway-team.";

function encodeSubprotocolValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function getGatewayRealtimeWebSocketProtocols(
  token: string,
  options?: { teamIdOrSlug?: string },
): string[] {
  const protocols = [
    GATEWAY_REALTIME_SUBPROTOCOL,
    `${GATEWAY_AUTH_SUBPROTOCOL_PREFIX}${token}`,
  ];
  if (options?.teamIdOrSlug) {
    protocols.push(
      `${GATEWAY_TEAM_SUBPROTOCOL_PREFIX}${encodeSubprotocolValue(options.teamIdOrSlug)}`,
    );
  }
  return protocols;
}
