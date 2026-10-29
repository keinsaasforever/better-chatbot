import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import { VoiceDeviceTable, VoiceSessionTable } from "@/lib/db/pg/schema.pg";
import {
  authenticateVoiceGateway,
  unauthorizedGatewayResponse,
} from "lib/voice/gateway/gateway-auth";
import { getVoiceSessionPolicy } from "lib/voice/gateway/voice-session-policy";
import { resolveVoiceBillingCustomerId } from "lib/voice/billing-customer";
import { VoiceGatewayCreateSessionSchema } from "lib/voice/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!authenticateVoiceGateway(request)) {
      return unauthorizedGatewayResponse();
    }

    const input = VoiceGatewayCreateSessionSchema.parse(await request.json());
    const [device] = await pgDb
      .select({
        id: VoiceDeviceTable.id,
        userId: VoiceDeviceTable.userId,
        organizationId: VoiceDeviceTable.organizationId,
        status: VoiceDeviceTable.status,
      })
      .from(VoiceDeviceTable)
      .where(
        and(
          eq(VoiceDeviceTable.id, input.deviceId),
          eq(VoiceDeviceTable.userId, input.userId),
        ),
      )
      .limit(1);

    if (!device || device.status !== "active") {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    const billingCustomerId = await resolveVoiceBillingCustomerId({
      userId: device.userId,
      organizationId: device.organizationId ?? input.organizationId,
    });
    const mode = input.requestedMode;
    const policy = getVoiceSessionPolicy(mode);

    const [existing] = await pgDb
      .select()
      .from(VoiceSessionTable)
      .where(
        and(
          eq(VoiceSessionTable.deviceId, input.deviceId),
          eq(VoiceSessionTable.sessionId, input.deviceSessionId),
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json({
        session: existing,
        policy,
        resumed: true,
      });
    }

    const [session] = await pgDb
      .insert(VoiceSessionTable)
      .values({
        userId: device.userId,
        organizationId: device.organizationId ?? input.organizationId ?? null,
        billingCustomerId,
        deviceId: input.deviceId,
        mode,
        status: "active",
        sessionId: input.deviceSessionId,
        provider: "assemblyai",
        lastHeartbeatAt: new Date(),
      })
      .returning();

    return NextResponse.json(
      { session, policy, resumed: false },
      { status: 201 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create voice session" },
      { status: 400 },
    );
  }
}
