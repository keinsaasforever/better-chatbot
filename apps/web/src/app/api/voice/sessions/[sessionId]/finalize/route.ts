import { pgDb } from "@/lib/db/pg/db.pg";
import {
  VoiceDeviceTable,
  VoiceSessionTable,
  VoiceTranscriptSegmentTable,
  VoiceTranscriptTable,
} from "@/lib/db/pg/schema.pg";
import { asc, eq } from "drizzle-orm";
import { analyzeLongVoiceCapture } from "lib/voice/analyze-long-voice-capture";
import { trackVoiceAssemblyUsage } from "lib/voice/track-usage";
import type { AuthenticatedVoiceDevice } from "lib/voice/device-auth";
import {
  authenticateVoiceGateway,
  unauthorizedGatewayResponse,
} from "lib/voice/gateway/gateway-auth";
import { runTranscriptCommand } from "lib/voice/run-transcript-command";
import { VoiceGatewayFinalizeSchema } from "lib/voice/schemas";
import type { VoiceTranscriptIntent } from "lib/voice/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function targetTypeForIntent(intent?: string): VoiceSessionTargetType | null {
  if (intent === "workflow") return "workflow_draft";
  if (intent === "agent") return "agent_draft";
  if (intent === "scheduled_agent") return "scheduled_agent";
  if (intent === "task") return "task_chat";
  if (intent === "note") return "note";
  if (intent === "question") return "question";
  return null;
}

type VoiceSessionTargetType =
  | "note"
  | "task_chat"
  | "workflow_draft"
  | "agent_draft"
  | "scheduled_agent"
  | "question"
  | "long_capture_summary";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  let routeSessionId: string | null = null;
  try {
    if (!authenticateVoiceGateway(request)) {
      return unauthorizedGatewayResponse();
    }

    const { sessionId } = await params;
    routeSessionId = sessionId;
    const input = VoiceGatewayFinalizeSchema.parse(await request.json());
    console.info("[voice-session-finalize] request received", {
      sessionId,
      reason: input.reason,
      status: input.status,
    });
    const [session] = await pgDb
      .select()
      .from(VoiceSessionTable)
      .where(eq(VoiceSessionTable.id, sessionId))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const segments = await pgDb
      .select()
      .from(VoiceTranscriptSegmentTable)
      .where(eq(VoiceTranscriptSegmentTable.voiceSessionId, sessionId))
      .orderBy(asc(VoiceTranscriptSegmentTable.sequenceNumber));

    const transcriptText = segments
      .filter((segment) => segment.isFinal)
      .map((segment) => segment.text)
      .join(" ")
      .trim();

    console.info("[voice-session-finalize] loaded session transcript", {
      sessionId,
      deviceSessionId: session.sessionId,
      userId: session.userId,
      mode: session.mode,
      segmentCount: segments.length,
      finalSegmentCount: segments.filter((segment) => segment.isFinal).length,
      transcriptLength: transcriptText.length,
    });

    const endedAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.ceil((endedAt.getTime() - session.startedAt.getTime()) / 1000),
    );
    const remainingBillableSeconds = Math.max(
      0,
      durationSeconds - session.billedAssemblyaiSeconds,
    );

    console.info("[voice-session-finalize] computed duration", {
      sessionId,
      durationSeconds,
      billedAssemblyaiSeconds: session.billedAssemblyaiSeconds,
      remainingBillableSeconds,
    });

    if (remainingBillableSeconds > 0) {
      await trackVoiceAssemblyUsage({
        voiceSessionId: session.id,
        billingCustomerId: session.billingCustomerId,
        billingEntityId:
          session.billingCustomerId === session.userId
            ? undefined
            : session.userId,
        seconds: remainingBillableSeconds,
        idempotencyKey: `voice-assemblyai:${session.id}:final:${remainingBillableSeconds}`,
        properties: { finalizeReason: input.reason, mode: session.mode },
      }).catch((error) => {
        console.error("Failed to track final voice AssemblyAI usage", error);
      });
    }

    let analysisResult: Record<string, unknown> = {};
    let targetType: VoiceSessionTargetType | null = null;
    let targetId: string | null = null;
    let projectId: string | null = null;
    let createdThreadId: string | null = null;
    let createdWorkflowId: string | null = null;
    let createdAgentId: string | null = null;
    let createdScheduledTaskId: string | null = null;
    let actionStatus:
      | "stored"
      | "needs_review"
      | "executed"
      | "failed"
      | "ignored" = transcriptText ? "stored" : "ignored";
    let intent: VoiceTranscriptIntent = "unknown";

    const [device] = session.deviceId
      ? await pgDb
          .select({ displayName: VoiceDeviceTable.displayName })
          .from(VoiceDeviceTable)
          .where(eq(VoiceDeviceTable.id, session.deviceId))
          .limit(1)
      : [];

    const actor: AuthenticatedVoiceDevice = {
      userId: session.userId,
      organizationId: session.organizationId,
      deviceId: session.deviceId ?? undefined,
      source: "m5stack",
      deviceDisplayName: device?.displayName ?? "Voice device",
    };

    if (transcriptText && session.mode === "voice_command") {
      console.info("[voice-session-finalize] running transcript command", {
        sessionId,
        deviceSessionId: session.sessionId,
        transcriptLength: transcriptText.length,
      });
      const result = await runTranscriptCommand({
        actor,
        text: transcriptText,
        sessionId: session.sessionId,
      });
      analysisResult = result.classification ?? {};
      targetType = targetTypeForIntent(result.intent);
      targetId =
        result.createdScheduledTaskId ??
        result.createdAgentId ??
        result.createdWorkflowId ??
        result.createdThreadId ??
        result.projectId ??
        null;
      projectId = result.projectId ?? null;
      createdThreadId = result.createdThreadId ?? null;
      createdWorkflowId = result.createdWorkflowId ?? null;
      createdAgentId = result.createdAgentId ?? null;
      createdScheduledTaskId = result.createdScheduledTaskId ?? null;
      actionStatus = result.actionStatus ?? "executed";
      intent = result.intent ?? "unknown";
      console.info("[voice-session-finalize] transcript command completed", {
        sessionId,
        intent,
        actionStatus,
        targetType,
        targetId,
        createdThreadId,
        createdWorkflowId,
        createdAgentId,
        createdScheduledTaskId,
      });
    } else if (transcriptText && session.mode === "long_capture") {
      console.info("[voice-session-finalize] analyzing long capture", {
        sessionId,
        transcriptLength: transcriptText.length,
      });
      const analysis = await analyzeLongVoiceCapture({
        actor,
        voiceSessionId: session.id,
        transcriptText,
      });
      analysisResult = analysis;
      targetType = "long_capture_summary";
      actionStatus = "stored";
      intent = "note";
    }

    await pgDb
      .insert(VoiceTranscriptTable)
      .values({
        userId: session.userId,
        projectId,
        sessionId: session.sessionId,
        eventId: "final",
        deviceId: session.deviceId,
        text: transcriptText || "[No speech detected]",
        normalizedText: transcriptText || null,
        intent,
        classification: {
          ...analysisResult,
          source: "voice_device_streaming",
          voiceSessionId: session.id,
          mode: session.mode,
          finalizeReason: input.reason,
          createdThreadId,
          createdWorkflowId,
          createdAgentId,
          createdScheduledTaskId,
        },
        actionStatus,
      })
      .onConflictDoNothing();

    const [updatedSession] = await pgDb
      .update(VoiceSessionTable)
      .set({
        status: input.status,
        endedAt,
        durationSeconds,
        audioSeconds: durationSeconds,
        transcriptText: transcriptText || null,
        analysisStatus: transcriptText ? "completed" : "skipped",
        analysisResult,
        targetType,
        targetId,
        projectId,
        createdThreadId,
        createdWorkflowId,
        createdAgentId,
        createdScheduledTaskId,
        finalizeReason: input.reason,
        finalizedAt: endedAt,
        updatedAt: endedAt,
      })
      .where(eq(VoiceSessionTable.id, session.id))
      .returning();

    console.info("[voice-session-finalize] session finalized", {
      sessionId,
      status: updatedSession?.status,
      actionStatus,
      intent,
      targetType,
      targetId,
    });

    return NextResponse.json({ session: updatedSession });
  } catch (error: any) {
    console.error("[voice-session-finalize] failed", {
      sessionId: routeSessionId,
      error: error?.message ?? String(error),
      stack: error?.stack,
    });
    return NextResponse.json(
      { error: error?.message ?? "Failed to finalize voice session" },
      { status: 400 },
    );
  }
}
