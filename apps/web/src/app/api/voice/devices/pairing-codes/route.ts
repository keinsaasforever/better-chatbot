import { withAuth } from "auth/route-guard";
import { voiceDeviceRepository } from "lib/db/repository";
import {
  generatePairingCode,
  getVoiceDeviceTokenPepper,
  hashPairingCode,
} from "lib/voice/device-token";
import { CreatePairingCodeSchema } from "lib/voice/schemas";
import {
  DEFAULT_VOICE_DEVICE_TYPE,
  PAIRING_CODE_TTL_MS,
} from "lib/voice/types";
import { NextResponse } from "next/server";

export const POST = withAuth(async (request, session) => {
  try {
    getVoiceDeviceTokenPepper();
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const json = await request.json().catch(() => ({}));
    const body = CreatePairingCodeSchema.parse(json);
    const organizationId =
      (session.session as { activeOrganizationId?: string } | undefined)
        ?.activeOrganizationId ?? null;

    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    await voiceDeviceRepository.createPairingCode({
      userId: session.user.id,
      organizationId,
      deviceType: body.deviceType ?? DEFAULT_VOICE_DEVICE_TYPE,
      displayName: body.displayName ?? null,
      codeHash: hashPairingCode(code),
      expiresAt,
    });

    return NextResponse.json({
      code,
      expiresAt: expiresAt.toISOString(),
      deviceType: body.deviceType ?? DEFAULT_VOICE_DEVICE_TYPE,
      displayName: body.displayName ?? null,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to create pairing code" },
      { status: 400 },
    );
  }
});
