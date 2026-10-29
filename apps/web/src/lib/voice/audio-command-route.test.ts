import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoNothing: vi.fn(),
}));

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    insert: dbMocks.insert,
  },
}));

vi.mock("lib/voice/device-auth", () => ({
  authenticateVoiceDevice: vi.fn(),
}));

vi.mock("lib/voice/assemblyai", () => ({
  transcribeAudioWithAssemblyAI: vi.fn(),
}));

vi.mock("lib/voice/run-transcript-command", () => ({
  runTranscriptCommand: vi.fn(),
}));

const { POST } = await import("../../app/api/voice/audio-command/route");
const { authenticateVoiceDevice } = await import("lib/voice/device-auth");
const { transcribeAudioWithAssemblyAI } = await import("lib/voice/assemblyai");
const { runTranscriptCommand } = await import(
  "lib/voice/run-transcript-command"
);

function wavBody() {
  const body = new Uint8Array(48);
  body.set([...Buffer.from("RIFF")], 0);
  body.set([...Buffer.from("WAVE")], 8);
  return body;
}

describe("POST /api/voice/audio-command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.insert.mockReturnValue({ values: dbMocks.values });
    dbMocks.values.mockReturnValue({
      onConflictDoNothing: dbMocks.onConflictDoNothing,
    });
    dbMocks.onConflictDoNothing.mockResolvedValue(undefined);
    vi.mocked(authenticateVoiceDevice).mockResolvedValue({
      userId: "user-1",
      organizationId: null,
      source: "m5stack",
      deviceId: "device-1",
      deviceDisplayName: "Desk Echo",
    });
  });

  it("rejects unauthenticated device requests", async () => {
    vi.mocked(authenticateVoiceDevice).mockResolvedValue(null);

    const response = await POST(
      new Request("http://localhost/api/voice/audio-command?sessionId=s1", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wavBody(),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("transcribes audio, executes the command, and stores device history", async () => {
    vi.mocked(transcribeAudioWithAssemblyAI).mockResolvedValue({
      text: "Create a task called test from Atom.",
      verbatimText: "create a task called test from atom",
      language: "en",
      confidence: 0.91,
      transcriptId: "assembly-1",
    });
    vi.mocked(runTranscriptCommand).mockResolvedValue({
      type: "agent.result",
      sessionId: "s1",
      message: "Task created.",
      actions: [{ toolName: "tasks.create", ok: true, summary: "created" }],
    });

    const response = await POST(
      new Request("http://localhost/api/voice/audio-command?sessionId=s1", {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: wavBody(),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      transcript: "Create a task called test from Atom.",
      message: "Task created.",
    });
    expect(runTranscriptCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Create a task called test from Atom.",
        sessionId: "s1",
      }),
    );
    expect(dbMocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        projectId: null,
        deviceId: "device-1",
        text: "Create a task called test from Atom.",
        actionStatus: "executed",
      }),
    );
  });
});
