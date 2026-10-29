export const VOICE_REALTIME_MODEL = "openai/gpt-realtime-2";

/**
 * The language a voice session answers in by default. A property of the voice
 * preset (Jarvis speaks English, the plain voices German) and sent once to the
 * server prompt, so the prompt never carries two default languages: two
 * contradicting rules are what made answers flip between German and English.
 */
export type VoiceLanguage = "de" | "en";
export const DEFAULT_VOICE_LANGUAGE: VoiceLanguage = "de";

/** A closed set: anything a client sends that is not a known language is ignored. */
export function parseVoiceLanguage(value: unknown): VoiceLanguage {
  return value === "en" || value === "de" ? value : DEFAULT_VOICE_LANGUAGE;
}

/**
 * Input transcription for the realtime session. `gpt-4o-transcribe` hears
 * German and English noticeably better than the provider default, and the
 * prompt primes it with the product words it otherwise mangles ("keinsaas"
 * comes back as "kein SaaS"). The language is deliberately NOT pinned: the
 * owner sometimes switches mid-conversation, so the prompt only leans the
 * transcript towards the session's default language.
 */
export const VOICE_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";
const VOICE_TRANSCRIPTION_TERMS =
  "keinsaas, Navigator, Cockpit, Agent, Workflow, Projekt, Stripe, Revolut, Superlog.";
export function getVoiceTranscriptionPrompt(language: VoiceLanguage): string {
  return language === "en"
    ? `Mostly English, sometimes German. Terms: ${VOICE_TRANSCRIPTION_TERMS}`
    : `Überwiegend Deutsch, manchmal Englisch. Begriffe: ${VOICE_TRANSCRIPTION_TERMS}`;
}

const sanitize = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export function getAiGatewayBaseUrl(): string | undefined {
  return sanitize(
    process.env.AI_GATEWAY_URL ??
      process.env.AI_GATEWAY_BASE_URL ??
      process.env.VERCEL_AI_GATEWAY_URL ??
      process.env.VERCEL_AI_GATEWAY_BASE_URL ??
      process.env.VERCEL_AI_URL,
  );
}

export function getAiGatewayApiKey(): string | undefined {
  return sanitize(
    process.env.AI_GATEWAY_API_KEY ??
      process.env.VERCEL_AI_GATEWAY_API_KEY ??
      process.env.VERCEL_AI_API_KEY ??
      process.env.VERCEL_AI_GATEWAY_TOKEN ??
      process.env.VERCEL_AI_TOKEN,
  );
}

/**
 * On Vercel the gateway falls back to the deployment's OIDC token, so a key is
 * only required everywhere else.
 */
export function isAiGatewayConfigured(): boolean {
  return Boolean(getAiGatewayApiKey()) || process.env.VERCEL === "1";
}

export function getAiGatewayTeamIdOrSlug(): string | undefined {
  return sanitize(
    process.env.AI_GATEWAY_TEAM_ID_OR_SLUG ??
      process.env.VERCEL_AI_GATEWAY_TEAM_ID ??
      process.env.VERCEL_AI_GATEWAY_TEAM_SLUG,
  );
}
