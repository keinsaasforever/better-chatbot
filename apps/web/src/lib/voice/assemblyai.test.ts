import { beforeEach, describe, expect, it, vi } from "vitest";
import { transcribeAudioWithAssemblyAI } from "./assemblyai";

const fetchMock = vi.fn();

/** Reads the JSON `config` part back out of a multipart body. */
async function configFrom(form: FormData): Promise<Record<string, unknown>> {
  const part = form.get("config");
  if (!(part instanceof Blob)) throw new Error("no config part");
  return JSON.parse(await part.text());
}

describe("transcribeAudioWithAssemblyAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ASSEMBLYAI_API_KEY", "test-key");
    vi.stubEnv("ASSEMBLYAI_DICTATION_BASE_URL", "https://dictation.test");
    vi.stubEnv("ASSEMBLYAI_DICTATION_LANGUAGES", "");
    vi.stubGlobal("fetch", fetchMock);
  });

  it("returns the cleaned-up dictation in one call", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        text: "um create a task from the Atom",
        llm_response: "Create a task from the Atom.",
        confidence: 0.92,
        session_id: "session-1",
      }),
    );

    const result = await transcribeAudioWithAssemblyAI({
      audio: new ArrayBuffer(4),
      language: "en",
    });

    expect(result).toEqual({
      text: "Create a task from the Atom.",
      verbatimText: "um create a task from the Atom",
      language: "en",
      confidence: 0.92,
      transcriptId: "session-1",
    });

    // One round trip, not an upload/submit/poll trio.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://dictation.test/v1/transcribe/live");
    expect(init.method).toBe("POST");
    // The raw key, no "Bearer " prefix.
    expect(init.headers).toEqual({ Authorization: "test-key" });
  });

  it("sends the config part before the audio part", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ text: "hello", session_id: "s" }),
    );

    await transcribeAudioWithAssemblyAI({ audio: new ArrayBuffer(4) });

    const form = fetchMock.mock.calls[0][1].body as FormData;
    // The server starts transcribing as the body arrives and rejects a request
    // whose audio precedes its config.
    expect([...form.keys()]).toEqual(["config", "audio"]);
  });

  it("falls back to the verbatim transcript when the rewrite fails", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        text: "create a task",
        llm_response: null,
        llm_error: "timeout",
        session_id: "session-2",
      }),
    );

    const result = await transcribeAudioWithAssemblyAI({
      audio: new ArrayBuffer(4),
    });

    // A failed rewrite still returns 200 with the transcription intact; it is
    // never a request failure.
    expect(result.text).toBe("create a task");
    expect(result.verbatimText).toBe("create a task");
  });

  it("asks for the product's languages when the caller names none", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ text: "hallo", session_id: "s" }),
    );

    const result = await transcribeAudioWithAssemblyAI({
      audio: new ArrayBuffer(4),
    });

    const config = await configFrom(fetchMock.mock.calls[0][1].body);
    expect(config.language_codes).toEqual(["en", "de"]);
    // Dictation takes languages as input and reports no detected one.
    expect(result.language).toBeUndefined();
  });

  it("narrows to a single language when the caller names one", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ text: "bonjour", session_id: "s" }),
    );

    await transcribeAudioWithAssemblyAI({
      audio: new ArrayBuffer(4),
      language: "fr",
    });

    const config = await configFrom(fetchMock.mock.calls[0][1].body);
    expect(config.language_codes).toEqual(["fr"]);
  });

  it("passes keyterms and a custom instruction through", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ text: "hi", session_id: "s" }),
    );

    await transcribeAudioWithAssemblyAI({
      audio: new ArrayBuffer(4),
      keyterms: ["Keinsaas", "Navigator"],
      instruction: "Format as a bulleted list.",
    });

    const config = await configFrom(fetchMock.mock.calls[0][1].body);
    expect(config.keyterms_prompt).toEqual(["Keinsaas", "Navigator"]);
    expect(config.llm_instruction).toBe("Format as a bulleted list.");
  });

  it("omits llm_instruction so the default cleanup applies", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ text: "hi", session_id: "s" }),
    );

    await transcribeAudioWithAssemblyAI({ audio: new ArrayBuffer(4) });

    const config = await configFrom(fetchMock.mock.calls[0][1].body);
    expect(config).not.toHaveProperty("llm_instruction");
  });

  it("surfaces the detail field from an error body", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { status: 401, title: "Unauthorized", detail: "Invalid API key" },
        { status: 401 },
      ),
    );

    await expect(
      transcribeAudioWithAssemblyAI({ audio: new ArrayBuffer(4) }),
    ).rejects.toThrow("Invalid API key");
  });

  it("surfaces the error field from a request-parsing failure", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { error: "config part must precede audio", error_code: "bad_request" },
        { status: 400 },
      ),
    );

    await expect(
      transcribeAudioWithAssemblyAI({ audio: new ArrayBuffer(4) }),
    ).rejects.toThrow("config part must precede audio");
  });

  it("requires a server-side AssemblyAI API key", async () => {
    vi.stubEnv("ASSEMBLYAI_API_KEY", "");

    await expect(
      transcribeAudioWithAssemblyAI({ audio: new ArrayBuffer(4) }),
    ).rejects.toThrow("ASSEMBLYAI_API_KEY is not configured");
  });
});
