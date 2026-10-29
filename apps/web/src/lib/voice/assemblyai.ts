/**
 * Dictation via AssemblyAI's Dictation API.
 *
 * This replaced the async batch pipeline (`POST /v2/upload` -> `POST
 * /v2/transcript` -> poll `GET /v2/transcript/{id}` every 1.5s until
 * `completed`). That was three-plus round trips and a polling loop for what is
 * almost always a few seconds of speech, and its 45s ceiling failed outright on
 * anything longer. The Dictation API answers in a single call.
 *
 * It also cleans the dictation up by default: filler removed, self-corrections
 * resolved to what the speaker landed on, punctuation and capitalisation
 * applied. The verbatim transcript comes back alongside it, so callers that
 * need the raw words still have them.
 *
 * Docs: https://www.assemblyai.com/docs/dictation
 */

/**
 * The Dictation API is a separate service from Pre-recorded and Streaming, on
 * its own hostname, so this is not the `api.eu.assemblyai.com` the batch
 * pipeline used.
 *
 * NOTE ON DATA RESIDENCY: the batch pipeline this replaced was deliberately
 * pinned to the EU zone. The default below is the global endpoint. If audio
 * must stay in the EU, set ASSEMBLYAI_DICTATION_BASE_URL to the EU dictation
 * host — see "Cloud endpoints & data residency" in the docs above.
 */
const DEFAULT_DICTATION_BASE_URL = "https://dictation.assemblyai.com";

/**
 * Typical short clips answer in well under a second. The rewrite has its own
 * 5s server-side deadline after which the transcription returns regardless, so
 * this only has to cover a slow upload. The docs recommend 90s.
 */
const DICTATION_TIMEOUT_MS = 90_000;

/**
 * Languages to consider when the caller does not name one.
 *
 * `language_codes` is an input here, not something the service reports back —
 * unlike the batch API, which did its own detection and returned
 * `language_code`. Leaving it unset would default to English alone and quietly
 * mis-transcribe German dictation, so the product's two working languages are
 * the default. Override with ASSEMBLYAI_DICTATION_LANGUAGES (comma-separated).
 */
const DEFAULT_DICTATION_LANGUAGES = ["en", "de"];

type DictationResponse = {
  /** The verbatim transcript. Never altered by the LLM. */
  text?: string | null;
  /** The cleaned-up text, or null when the rewrite failed. */
  llm_response?: string | null;
  /** "timeout" or "error" when the rewrite failed. Not a request failure. */
  llm_error?: string | null;
  confidence?: number | null;
  audio_duration_ms?: number | null;
  session_id?: string | null;
};

export type AssemblyAITranscriptionResult = {
  /**
   * What to show the user: the cleaned-up dictation, falling back to the
   * verbatim transcript when the rewrite failed or was declined.
   */
  text: string;
  /** The words exactly as spoken, before any cleanup. */
  verbatimText: string;
  language?: string;
  confidence?: number;
  transcriptId: string;
};

function getDictationConfig() {
  const apiKey = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not configured");
  }

  const baseUrl = (
    process.env.ASSEMBLYAI_DICTATION_BASE_URL ?? DEFAULT_DICTATION_BASE_URL
  ).replace(/\/$/, "");

  const configured = process.env.ASSEMBLYAI_DICTATION_LANGUAGES?.trim();
  const defaultLanguages = configured
    ? configured
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean)
    : DEFAULT_DICTATION_LANGUAGES;

  return { apiKey, baseUrl, defaultLanguages };
}

/**
 * Dictation reports failures in two shapes: `{status, title, detail}` for auth
 * and config validation, and `{error, error_code}` for errors it raises while
 * parsing the request itself. Read both.
 */
async function readDictationError(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) return `AssemblyAI dictation failed with ${response.status}`;

  try {
    const parsed = JSON.parse(body) as {
      detail?: unknown;
      title?: unknown;
      error?: unknown;
    };
    for (const field of [parsed.error, parsed.detail, parsed.title]) {
      if (typeof field === "string" && field) return field;
    }
  } catch {
    // Not JSON — fall through to the raw body.
  }
  return body.slice(0, 500);
}

export async function transcribeAudioWithAssemblyAI({
  audio,
  language,
  keyterms,
  instruction,
}: {
  audio: ArrayBuffer;
  language?: string | null;
  /** Names and jargon to bias the transcript toward (max 100 terms). */
  keyterms?: string[];
  /**
   * Replaces the default cleanup task. Omit to keep the default, which is what
   * dictation into a text field wants.
   */
  instruction?: string;
}): Promise<AssemblyAITranscriptionResult> {
  const { apiKey, baseUrl, defaultLanguages } = getDictationConfig();

  const normalizedLanguage = language?.trim();
  const config: Record<string, unknown> = {
    language_codes: normalizedLanguage
      ? [normalizedLanguage]
      : defaultLanguages,
  };
  if (keyterms?.length) config.keyterms_prompt = keyterms;
  if (instruction?.trim()) config.llm_instruction = instruction.trim();

  // The config part must arrive before the first audio byte: the server starts
  // transcribing as the body streams in and cannot begin without it. An audio
  // part that arrives first is rejected with 400.
  const form = new FormData();
  form.append(
    "config",
    new Blob([JSON.stringify(config)], { type: "application/json" }),
  );
  form.append("audio", new Blob([audio], { type: "audio/wav" }), "audio.wav");

  const response = await fetch(`${baseUrl}/v1/transcribe/live`, {
    method: "POST",
    // The raw key, with no "Bearer " prefix.
    headers: { Authorization: apiKey },
    body: form,
    signal: AbortSignal.timeout(DICTATION_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(await readDictationError(response));
  }

  const result = (await response.json()) as DictationResponse;
  const verbatim = result.text?.trim() ?? "";
  // A failed rewrite still returns 200 with the transcription intact, so
  // `llm_error` is never a request failure — fall back and carry on.
  const cleaned = result.llm_response?.trim() || verbatim;

  return {
    text: cleaned,
    verbatimText: verbatim,
    // Dictation takes languages as input and does not report a detected one,
    // so this is only set when the caller told us which language to expect.
    language: normalizedLanguage || undefined,
    confidence: result.confidence ?? undefined,
    transcriptId: result.session_id ?? "",
  };
}
