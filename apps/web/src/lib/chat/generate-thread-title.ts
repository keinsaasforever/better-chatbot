import { generateText } from "ai";

import type { ChatModel } from "app-types/chat";
import { customModelProvider } from "lib/ai/models";
import { CREATE_THREAD_TITLE_PROMPT } from "lib/ai/prompts";
import { aiTelemetry } from "lib/ai/telemetry";
import logger from "logger";

import {
  deriveThreadTitleFromText,
  normalizeThreadTitle,
} from "./thread-title";

/**
 * Fixed cheap model for title generation. Titling a <=500 char seed does not
 * need the user's chat model: on a frontier selection that billed Opus/Fable
 * rates for a ~10 token title.
 *
 * Pinned to the Navigator base model by alias rather than to a provider id, so
 * a base-model swap carries here instead of leaving a stale hardcoded model
 * behind (this used to read `moonshotai/kimi-k2.6` and kept billing Kimi long
 * after the base model moved to Z.ai GLM 5.3 Flash).
 */
export const THREAD_TITLE_MODEL: ChatModel = {
  provider: "Navigator",
  model: "Base model",
};

/**
 * Generates a thread title from a seed built out of the first message(s).
 *
 * Never throws and never returns whitespace: a failed or empty model call falls
 * back to the user's own text, because an untitled thread is permanent — the
 * sidebar renders it as "New Chat" forever and nothing retries.
 */
export async function generateThreadTitle({
  seed,
  telemetryId,
  telemetryMetadata,
  abortSignal,
}: {
  seed: string;
  telemetryId: string;
  telemetryMetadata?: Record<
    string,
    string | number | boolean | null | undefined
  >;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const fallback = deriveThreadTitleFromText(seed);
  if (!seed.trim()) return fallback;

  try {
    const { text } = await generateText({
      model: customModelProvider.getModel(THREAD_TITLE_MODEL),
      system: CREATE_THREAD_TITLE_PROMPT,
      experimental_telemetry: aiTelemetry(telemetryId, telemetryMetadata),
      prompt: seed,
      abortSignal,
    });
    return normalizeThreadTitle(text) || fallback;
  } catch (error) {
    logger.error("Thread title generation failed", error);
    return fallback;
  }
}
