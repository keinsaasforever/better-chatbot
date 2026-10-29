import { withAuth } from "auth/route-guard";
import { voiceDeviceRepository } from "lib/db/repository";
import { RevokeVoiceDeviceSchema } from "lib/voice/schemas";
import { NextResponse } from "next/server";

export const POST = withAuth(async (request, session) => {
  try {
    const json = await request.json();
    const body = RevokeVoiceDeviceSchema.parse(json);
    const revoked = await voiceDeviceRepository.revokeDevice(
      body.deviceId,
      session.user.id,
    );

    if (!revoked) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to revoke device" },
      { status: 400 },
    );
  }
});
