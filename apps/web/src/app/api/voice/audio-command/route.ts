import { authenticateVoiceDevice } from "lib/voice/device-auth";
import { isWavAudio, processVoiceAudioCommand } from "lib/voice/audio-command";
import { VoiceAudioCommandMetadataSchema } from "lib/voice/schemas";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 1_000_000;

function getMetadata(request: Request) {
  const url = new URL(request.url);
  return VoiceAudioCommandMetadataSchema.parse({
    sessionId:
      url.searchParams.get("sessionId") ??
      request.headers.get("x-session-id") ??
      "",
    language:
      url.searchParams.get("language") ??
      request.headers.get("x-language") ??
      undefined,
    durationMs:
      url.searchParams.get("durationMs") ??
      request.headers.get("x-duration-ms") ??
      undefined,
    eventId:
      url.searchParams.get("eventId") ??
      request.headers.get("x-event-id") ??
      undefined,
    source:
      url.searchParams.get("source") ??
      request.headers.get("x-source") ??
      undefined,
  });
}

export async function POST(request: Request) {
  const actor = await authenticateVoiceDevice(request);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const metadata = getMetadata(request);
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("audio/wav")) {
      return NextResponse.json(
        { error: "Content-Type must be audio/wav" },
        { status: 415 },
      );
    }

    const audio = await request.arrayBuffer();
    if (audio.byteLength > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: "Audio command is too large" },
        { status: 413 },
      );
    }
    if (!isWavAudio(audio)) {
      return NextResponse.json(
        { error: "Audio command must be a WAV file" },
        { status: 400 },
      );
    }

    const result = await processVoiceAudioCommand({
      actor,
      audio,
      sessionId: metadata.sessionId,
      language: metadata.language,
      durationMs: metadata.durationMs,
      eventId: metadata.eventId,
      source: metadata.source,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to process audio command" },
      { status: 400 },
    );
  }
}
