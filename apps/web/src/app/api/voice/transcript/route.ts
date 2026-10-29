import { rememberAgentAction } from "@/app/api/chat/actions";
import { saveVoiceDeviceHistory } from "lib/voice/audio-command";
import { authenticateVoiceDevice } from "lib/voice/device-auth";
import { runTranscriptCommand } from "lib/voice/run-transcript-command";
import { VoiceTranscriptSchema } from "lib/voice/schemas";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const actor = await authenticateVoiceDevice(request);
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const json = await request.json();
    const body = VoiceTranscriptSchema.parse(json);

    if (body.deviceId && body.deviceId !== actor.deviceId) {
      return NextResponse.json({ error: "Device mismatch" }, { status: 403 });
    }

    if (body.agentId) {
      const agent = await rememberAgentAction(
        body.agentId,
        actor.userId,
        actor.organizationId,
      );
      if (!agent) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }
    }

    const result = await runTranscriptCommand({
      actor,
      text: body.text,
      sessionId: body.sessionId,
      agentId: body.agentId,
    });

    // Persist the transcript (idempotent on user+session+event). Best-effort:
    // a history write must never fail the device response.
    await saveVoiceDeviceHistory({
      userId: actor.userId,
      deviceId: actor.deviceId,
      projectId: result.projectId ?? null,
      sessionId: body.sessionId,
      eventId: body.eventId ?? "final",
      text: body.text,
      language: body.language,
      intent: result.intent ?? "command",
      actionStatus: result.actionStatus ?? "executed",
      classification: {
        source: "atom_echo_s3r_transcript",
        responseMessage: result.message,
        actions: result.actions,
        ...(result.classification ?? {}),
        createdThreadId: result.createdThreadId ?? null,
        createdWorkflowId: result.createdWorkflowId ?? null,
      },
    }).catch(() => {});

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to process transcript" },
      { status: 400 },
    );
  }
}
