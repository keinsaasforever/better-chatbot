import "server-only";
import { generateObject, generateText, type LanguageModel } from "ai";
import type { z } from "zod";
import globalLogger from "logger";
import { aiTelemetry } from "lib/ai/telemetry";

const logger = globalLogger.withDefaults({ message: "Resilient Object: " });

/**
 * Thrown when the caller's `abortSignal` fires before a generation completes.
 *
 * The AI SDK surfaces an abort as `DOMException: Delay was aborted` — a message
 * that names neither the caller nor the deadline it blew, and whose DOMException
 * `code` of 20 is what OpenTelemetry records as the exception *type* (it prefers
 * `code` over `name`). That is how an extraction timeout reaches the tracing
 * backend as `20: <minified frame>` and gets mistaken for an SDK internal.
 */
export class GenerationAbortedError extends Error {
  readonly code = "generation_aborted";

  constructor(label: string, cause?: unknown) {
    super(
      `[${label}] aborted before completing: the caller's deadline expired.`,
      { cause },
    );
    this.name = "GenerationAbortedError";
  }
}

/**
 * Inngest replays a failed step's error from serialized state, which loses the
 * prototype — so callers that classify an error *after* a step boundary have to
 * fall back to the name.
 */
export function isGenerationAbortedError(error: unknown): boolean {
  return (
    error instanceof GenerationAbortedError ||
    (error as { name?: string } | null | undefined)?.name ===
      "GenerationAbortedError"
  );
}

/**
 * Pull a JSON object out of model text that may be wrapped in markdown fences
 * or surrounded by prose — the usual reasons strict generateObject parsing
 * fails ("No object generated: could not parse the response").
 */
export function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * generateObject that survives models with unreliable structured output
 * (e.g. Kimi via the gateway wrapping JSON in fences):
 *
 * 1. strict generateObject on the primary model
 * 2. generateText on the primary model + lenient JSON extraction + schema parse
 * 3. strict generateObject on the fallback model (when provided)
 *
 * Throws the first attempt's error only if every layer fails.
 */
export async function generateObjectResilient<T>(opts: {
  model: LanguageModel | string;
  fallbackModel?: LanguageModel | string;
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  label?: string;
  /**
   * Bounds all three attempts together. Without it a caller running inside a
   * timed background job can be stuck here for as long as the provider takes,
   * three times over.
   */
  abortSignal?: AbortSignal;
}): Promise<{
  object: T;
  via: "primary" | "text-repair" | "fallback";
}> {
  const label = opts.label ?? "generateObjectResilient";

  /**
   * Once the signal has fired, the remaining layers cannot succeed — they would
   * only re-reject on the same signal. Stop on the spot and report the deadline
   * rather than the SDK's opaque abort.
   */
  const abortedBy = (cause: unknown) =>
    opts.abortSignal?.aborted ? new GenerationAbortedError(label, cause) : null;

  let primaryError: unknown;
  try {
    const { object } = await generateObject({
      model: opts.model,
      experimental_telemetry: aiTelemetry("structured.generate", {
        attempt: "primary",
      }),
      abortSignal: opts.abortSignal,
      schema: opts.schema,
      system: opts.system,
      prompt: opts.prompt,
    });
    return { object: object as T, via: "primary" };
  } catch (error) {
    const aborted = abortedBy(error);
    if (aborted) throw aborted;
    primaryError = error;
    logger.warn(
      `[${label}] strict parse failed, trying text repair:`,
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const { text } = await generateText({
      model: opts.model,
      experimental_telemetry: aiTelemetry("structured.generate", {
        attempt: "text-repair",
      }),
      abortSignal: opts.abortSignal,
      system: `${opts.system}\n\nReturn ONLY a single JSON object. No markdown fences, no explanations, no text before or after the JSON.`,
      prompt: opts.prompt,
    });
    const object = opts.schema.parse(extractJsonObject(text));
    logger.info(`[${label}] recovered via text repair`);
    return { object, via: "text-repair" };
  } catch (error) {
    const aborted = abortedBy(error);
    if (aborted) throw aborted;
    logger.warn(
      `[${label}] text repair failed:`,
      error instanceof Error ? error.message : error,
    );
  }

  if (opts.fallbackModel) {
    try {
      const { object } = await generateObject({
        model: opts.fallbackModel,
        experimental_telemetry: aiTelemetry("structured.generate", {
          attempt: "fallback-model",
        }),
        abortSignal: opts.abortSignal,
        schema: opts.schema,
        system: opts.system,
        prompt: opts.prompt,
      });
      logger.info(`[${label}] recovered via fallback model`);
      return { object: object as T, via: "fallback" };
    } catch (error) {
      const aborted = abortedBy(error);
      if (aborted) throw aborted;
      logger.warn(
        `[${label}] fallback model failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  throw primaryError;
}
