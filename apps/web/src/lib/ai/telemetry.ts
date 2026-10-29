import { RECORD_AI_CONTENT } from "lib/observability/superlog";

/**
 * OpenTelemetry settings for AI SDK calls.
 *
 * Every model call in this app goes through Vercel AI Gateway as a bare string
 * model ID (see `register-gateway-provider.ts`), so there is no per-provider SDK
 * for OpenInference-style instrumentation to hook. The AI SDK's own telemetry is
 * the only way to see inside a gateway call — it emits `ai.streamText`,
 * `ai.streamText.doStream` and `ai.toolCall` spans carrying `gen_ai.*` semantic
 * convention attributes: request/response model, provider, input/output token
 * counts, finish reasons, and recorded exceptions on failure.
 *
 * ## Content capture
 *
 * `recordInputs` / `recordOutputs` default to **false**. The AI SDK would
 * otherwise attach full prompts and completions to spans, which for this app
 * means user chat text, extracted attachment content and tool arguments leaving
 * for a US-hosted intake. Set `SUPERLOG_RECORD_AI_CONTENT=1` to turn capture on
 * while debugging a specific issue — prefer dev/staging over production.
 *
 * ## Metadata
 *
 * Pass identifiers that make an incident actionable — `organizationId`,
 * `threadId`, `modelId` — and never PII. No user IDs, no emails, no free text:
 * these attributes are stored and grouped, not just displayed.
 */
export type AiTelemetryMetadata = Record<string, string | number | boolean>;

export type AiTelemetrySettings = {
  isEnabled: true;
  functionId: string;
  recordInputs: boolean;
  recordOutputs: boolean;
  metadata?: AiTelemetryMetadata;
};

/**
 * Drops nullish entries so callers can pass optional values inline without
 * every call site needing its own conditional spread. The AI SDK requires
 * metadata values to be scalar `AttributeValue`s.
 */
const compactMetadata = (
  metadata?: Record<string, string | number | boolean | null | undefined>,
): AiTelemetryMetadata | undefined => {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(
    (entry): entry is [string, string | number | boolean] =>
      entry[1] !== null && entry[1] !== undefined,
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

/**
 * Builds the `experimental_telemetry` option for a `streamText` /
 * `generateText` / `generateObject` call.
 *
 * @param functionId Stable `domain.verb` identifier, e.g. `chat.stream`. Used to
 *   group spans across requests, so keep it low-cardinality — never interpolate
 *   an ID into it.
 */
export function aiTelemetry(
  functionId: string,
  metadata?: Record<string, string | number | boolean | null | undefined>,
): AiTelemetrySettings {
  return {
    isEnabled: true,
    functionId,
    recordInputs: RECORD_AI_CONTENT,
    recordOutputs: RECORD_AI_CONTENT,
    metadata: compactMetadata(metadata),
  };
}
