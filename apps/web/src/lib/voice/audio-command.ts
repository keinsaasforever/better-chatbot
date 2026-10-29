import { pgDb } from "@/lib/db/pg/db.pg";
import { VoiceTranscriptTable } from "@/lib/db/pg/schema.pg";
import { transcribeAudioWithAssemblyAI } from "lib/voice/assemblyai";
import { runTranscriptCommand } from "lib/voice/run-transcript-command";
import { AuthenticatedVoiceDevice } from "./device-auth";

const TRANSCRIPTION_FAILED_TEXT = "[Transcription failed]";
const NO_SPEECH_TEXT = "[No speech detected]";

export type VoiceAudioCommandResponse = {
  type?: "agent.result";
  sessionId?: string;
  message?: string;
  actions?: unknown[];
  transcript?: string;
  language?: string | null;
  confidence?: number | null;
  error?: string;
};

export type VoiceAudioCommandResult = {
  status: number;
  body: VoiceAudioCommandResponse;
};

type VoiceActionStatus =
  | "stored"
  | "needs_review"
  | "executed"
  | "failed"
  | "ignored";

type VoiceIntent =
  | "memory"
  | "question"
  | "command"
  | "mixed"
  | "unknown"
  | "task"
  | "workflow"
  | "agent"
  | "scheduled_agent"
  | "note";

export function isWavAudio(audio: ArrayBuffer) {
  if (audio.byteLength < 44) {
    return false;
  }

  const header = new Uint8Array(audio, 0, 12);
  return (
    String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...header.slice(8, 12)) === "WAVE"
  );
}

export async function saveVoiceDeviceHistory({
  userId,
  deviceId,
  projectId = null,
  sessionId,
  eventId = "final",
  text,
  language,
  confidence,
  intent = "command",
  actionStatus,
  classification,
}: {
  userId: string;
  deviceId?: string;
  projectId?: string | null;
  sessionId: string;
  eventId?: string;
  text: string;
  language?: string;
  confidence?: number;
  intent?: VoiceIntent;
  actionStatus: VoiceActionStatus;
  classification: Record<string, unknown>;
}) {
  // Idempotent on (userId, sessionId, eventId): the device may retry a POST.
  await pgDb
    .insert(VoiceTranscriptTable)
    .values({
      userId,
      projectId,
      sessionId,
      eventId,
      deviceId: deviceId ?? null,
      text,
      normalizedText: text,
      language: language ?? null,
      confidence: confidence != null ? String(confidence) : null,
      intent,
      classification,
      actionStatus,
    })
    .onConflictDoNothing();
}

export async function processVoiceAudioCommand({
  actor,
  audio,
  sessionId,
  eventId = "final",
  language,
  durationMs,
  audioFormat = "audio/wav",
  source = "atom_echo_s3r_audio_command",
}: {
  actor: AuthenticatedVoiceDevice;
  audio: ArrayBuffer;
  sessionId: string;
  eventId?: string;
  language?: string;
  durationMs?: number;
  audioFormat?: string;
  source?: string;
}): Promise<VoiceAudioCommandResult> {
  let transcription;
  try {
    transcription = await transcribeAudioWithAssemblyAI({
      audio,
      language,
    });
  } catch (error: any) {
    await saveVoiceDeviceHistory({
      userId: actor.userId,
      deviceId: actor.deviceId,
      sessionId,
      eventId,
      text: TRANSCRIPTION_FAILED_TEXT,
      actionStatus: "failed",
      classification: {
        source,
        error: error.message || "Transcription failed",
        durationMs: durationMs ?? null,
        audioBytes: audio.byteLength,
        audioFormat,
      },
    });
    return {
      status: 502,
      body: { error: error.message || "Transcription failed" },
    };
  }

  if (!transcription.text) {
    await saveVoiceDeviceHistory({
      userId: actor.userId,
      deviceId: actor.deviceId,
      sessionId,
      eventId,
      text: NO_SPEECH_TEXT,
      language: transcription.language,
      confidence: transcription.confidence,
      actionStatus: "ignored",
      classification: {
        source,
        assemblyaiTranscriptId: transcription.transcriptId,
        durationMs: durationMs ?? null,
        audioBytes: audio.byteLength,
        audioFormat,
      },
    });
    return {
      status: 422,
      body: { error: "No speech detected", transcript: "" },
    };
  }

  let result;
  try {
    result = await runTranscriptCommand({
      actor,
      text: transcription.text,
      sessionId,
    });
  } catch (error: any) {
    await saveVoiceDeviceHistory({
      userId: actor.userId,
      deviceId: actor.deviceId,
      sessionId,
      eventId,
      text: transcription.text,
      language: transcription.language,
      confidence: transcription.confidence,
      actionStatus: "failed",
      classification: {
        source,
        assemblyaiTranscriptId: transcription.transcriptId,
        error: error.message || "Command execution failed",
        durationMs: durationMs ?? null,
        audioBytes: audio.byteLength,
        audioFormat,
      },
    });
    return {
      status: 500,
      body: { error: error.message || "Command execution failed" },
    };
  }

  await saveVoiceDeviceHistory({
    userId: actor.userId,
    deviceId: actor.deviceId,
    projectId: result.projectId ?? null,
    sessionId,
    eventId,
    text: transcription.text,
    language: transcription.language,
    confidence: transcription.confidence,
    intent: result.intent ?? "command",
    actionStatus: result.actionStatus ?? "executed",
    classification: {
      source,
      assemblyaiTranscriptId: transcription.transcriptId,
      durationMs: durationMs ?? null,
      audioBytes: audio.byteLength,
      audioFormat,
      responseMessage: result.message,
      actions: result.actions,
      ...(result.classification ?? {}),
      createdThreadId: result.createdThreadId ?? null,
      createdWorkflowId: result.createdWorkflowId ?? null,
      createdAgentId: result.createdAgentId ?? null,
      createdScheduledTaskId: result.createdScheduledTaskId ?? null,
    },
  });

  return {
    status: 200,
    body: {
      ...result,
      transcript: transcription.text,
      language: transcription.language ?? null,
      confidence: transcription.confidence ?? null,
    },
  };
}
