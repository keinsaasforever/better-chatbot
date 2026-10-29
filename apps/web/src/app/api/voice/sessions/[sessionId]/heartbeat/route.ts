import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import { VoiceSessionTable } from "@/lib/db/pg/schema.pg";
import {
  authenticateVoiceGateway,
  unauthorizedGatewayResponse,
} from "lib/voice/gateway/gateway-auth";
import { VoiceGatewayHeartbeatSchema } from "lib/voice/schemas";

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
    const input = VoiceGatewayHeartbeatSchema.parse(await request.json());
    const [session] = await pgDb
      .update(VoiceSessionTable)
      .set({
        lastHeartbeatAt: new Date(),
        lastAudioAt: input.lastAudioAt
          ? new Date(input.lastAudioAt)
          : undefined,
        lastSegmentAt: input.lastSegmentAt
          ? new Date(input.lastSegmentAt)
          : undefined,
        updatedAt: new Date(),
      })
      .where(eq(VoiceSessionTable.id, sessionId))
      .returning();

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update heartbeat" },
      { status: 400 },
    );
  }
}
