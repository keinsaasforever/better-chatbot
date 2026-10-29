import { withAuth } from "auth/route-guard";
import { and, desc, eq } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { VoiceTranscriptTable } from "@/lib/db/pg/schema.pg";
import { voiceDeviceRepository } from "lib/db/repository";
import { VoiceDeviceHistoryQuerySchema } from "lib/voice/schemas";
import { NextResponse } from "next/server";

function readClassification(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export const GET = withAuth(async (request, session) => {
  try {
    const query = VoiceDeviceHistoryQuerySchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const device = await voiceDeviceRepository.selectByIdForUser(
      query.deviceId,
      session.user.id,
    );
    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    const rows = await pgDb
      .select({
        id: VoiceTranscriptTable.id,
        sessionId: VoiceTranscriptTable.sessionId,
        text: VoiceTranscriptTable.text,
        language: VoiceTranscriptTable.language,
        confidence: VoiceTranscriptTable.confidence,
        actionStatus: VoiceTranscriptTable.actionStatus,
        classification: VoiceTranscriptTable.classification,
        createdAt: VoiceTranscriptTable.createdAt,
      })
      .from(VoiceTranscriptTable)
      .where(
        and(
          eq(VoiceTranscriptTable.userId, session.user.id),
          eq(VoiceTranscriptTable.deviceId, query.deviceId),
        ),
      )
      .orderBy(desc(VoiceTranscriptTable.createdAt))
      .limit(query.limit);

    return NextResponse.json({
      items: rows.map((row) => {
        const classification = readClassification(row.classification);
        return {
          id: row.id,
          sessionId: row.sessionId,
          text: row.text,
          language: row.language,
          confidence: row.confidence,
          actionStatus: row.actionStatus,
          message:
            typeof classification.responseMessage === "string"
              ? classification.responseMessage
              : null,
          actions: Array.isArray(classification.actions)
            ? classification.actions
            : [],
          createdAt: row.createdAt.toISOString(),
        };
      }),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load voice history" },
      { status: 400 },
    );
  }
});
