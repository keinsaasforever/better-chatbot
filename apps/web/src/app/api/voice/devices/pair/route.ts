import { voiceDeviceRepository } from "lib/db/repository";
import { getPublicApiBaseUrl } from "lib/voice/device-auth";
import {
  generateDeviceToken,
  getVoiceDeviceTokenPepper,
  hashDeviceToken,
  hashPairingCode,
} from "lib/voice/device-token";
import { RedeemPairingCodeSchema } from "lib/voice/schemas";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    getVoiceDeviceTokenPepper();
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const json = await request.json();
    const body = RedeemPairingCodeSchema.parse(json);
    const pairing = await voiceDeviceRepository.consumePairingCode({
      codeHash: hashPairingCode(body.code),
    });

    if (!pairing) {
      return NextResponse.json(
        { error: "Invalid or expired pairing code" },
        { status: 400 },
      );
    }

    if (pairing.deviceType !== body.deviceType) {
      return NextResponse.json(
        { error: "Device type does not match pairing code" },
        { status: 400 },
      );
    }

    const token = generateDeviceToken();
    const device = await voiceDeviceRepository.createDevice({
      userId: pairing.userId,
      organizationId: pairing.organizationId,
      deviceType: body.deviceType,
      displayName: body.displayName || pairing.displayName || "Voice Device",
      tokenHash: hashDeviceToken(token),
      firmwareVersion: body.firmwareVersion ?? null,
    });

    return NextResponse.json({
      deviceId: device.id,
      token,
      apiBaseUrl: getPublicApiBaseUrl(request),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to pair device" },
      { status: 400 },
    );
  }
}
