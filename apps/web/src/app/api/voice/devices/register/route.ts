import { voiceDeviceRepository } from "lib/db/repository";
import { getPublicApiBaseUrl } from "lib/voice/device-auth";
import {
  getVoiceDeviceTokenPepper,
  hashPairingCode,
} from "lib/voice/device-token";
import { DeviceRegistrationSchema } from "lib/voice/schemas";
import { PAIRING_CODE_TTL_MS } from "lib/voice/types";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    getVoiceDeviceTokenPepper();
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const json = await request.json();
    const body = DeviceRegistrationSchema.parse(json);
    const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
    const registration = await voiceDeviceRepository.createDeviceRegistration({
      codeHash: hashPairingCode(body.code),
      deviceType: body.deviceType,
      firmwareVersion: body.firmwareVersion ?? null,
      hardwareId: body.hardwareId ?? null,
      expiresAt,
    });

    return NextResponse.json({
      registrationId: registration.id,
      expiresAt: registration.expiresAt.toISOString(),
      apiBaseUrl: getPublicApiBaseUrl(request),
      status: registration.status,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to register device" },
      { status: 400 },
    );
  }
}
