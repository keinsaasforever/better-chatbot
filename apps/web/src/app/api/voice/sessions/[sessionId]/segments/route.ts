import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  VoiceSessionTable,
  VoiceTranscriptProviderConnectionTable,
  VoiceTranscriptSegmentTable,
} from "@/lib/db/pg/schema.pg";
import {
  authenticateVoiceGateway,
  unauthorizedGatewayResponse,
} from "lib/voice/gateway/gateway-auth";
import { VoiceGatewaySegmentSchema } from "lib/voice/schemas";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    if (!authenticateVoiceGateway(request)) {
      return unauthorizedGatewayResponse();
    }

    const { sessionId } = await params;
    const input = VoiceGatewaySegmentSchema.parse(await request.json());
    const [session] = await pgDb
      .select()
      .from(VoiceSessionTable)
      .where(eq(VoiceSessionTable.id, sessionId))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const [existingConnection] = await pgDb
      .select()
      .from(VoiceTranscriptProviderConnectionTable)
      .where(
        and(
          eq(VoiceTranscriptProviderConnectionTable.voiceSessionId, sessionId),
          eq(
            VoiceTranscriptProviderConnectionTable.providerConnectionId,
            input.providerConnectionId,
          ),
        ),
      )
      .limit(1);

    const providerConnection =
      existingConnection ??
      (
        await pgDb
          .insert(VoiceTranscriptProviderConnectionTable)
          .values({
            voiceSessionId: sessionId,
            provider: "assemblyai",
            providerConnectionId: input.providerConnectionId,
            sequenceStart: input.sequenceNumber,
            lastProviderEventAt: new Date(),
          })
          .returning()
      )[0];

    const [segment] = await pgDb
      .insert(VoiceTranscriptSegmentTable)
      .values({
        voiceSessionId: sessionId,
        providerConnectionId: providerConnection.id,
        sequenceNumber: input.sequenceNumber,
        idempotencyKey: input.idempotencyKey,
        providerSegmentId: input.providerSegmentId ?? null,
        startMs: input.startMs ?? null,
        endMs: input.endMs ?? null,
        text: input.text,
        isFinal: input.isFinal,
        language: input.language ?? null,
        confidence: input.confidence != null ? String(input.confidence) : null,
        providerPayload: input.providerPayload,
      })
      .onConflictDoNothing({
        target: [
          VoiceTranscriptSegmentTable.voiceSessionId,
          VoiceTranscriptSegmentTable.idempotencyKey,
        ],
      })
      .returning();

    if (segment) {
      await pgDb
        .update(VoiceTranscriptProviderConnectionTable)
        .set({
          sequenceEnd: input.sequenceNumber,
          lastProviderEventAt: new Date(),
        })
        .where(
          eq(VoiceTranscriptProviderConnectionTable.id, providerConnection.id),
        );

      await pgDb
        .update(VoiceSessionTable)
        .set({
          lastSegmentAt: new Date(),
          segmentCount: sql`${VoiceSessionTable.segmentCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(VoiceSessionTable.id, sessionId));
    }

    return NextResponse.json({ segment: segment ?? null, duplicate: !segment });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to save voice segment" },
      { status: 400 },
    );
  }
}
