import { voiceDeviceRepository } from "lib/db/repository";
import { getPublicApiBaseUrl } from "lib/voice/device-auth";
import {
  getVoiceDeviceTokenPepper,
  hashPairingCode,
} from "lib/voice/device-token";
import { CompleteDeviceRegistrationSchema } from "lib/voice/schemas";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    getVoiceDeviceTokenPepper();
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const json = await request.json();
    const body = CompleteDeviceRegistrationSchema.parse(json);
    const result = await voiceDeviceRepository.completeDeviceRegistration({
      registrationId: body.registrationId,
      codeHash: hashPairingCode(body.code),
    });

    if (!result) {
      const registration = await voiceDeviceRepository.selectRegistrationById(
        body.registrationId,
      );
      return NextResponse.json(
        {
          error: "Registration not ready or already completed",
          registrationStatus: registration?.status ?? "missing",
          expiresAt: registration?.expiresAt?.toISOString() ?? null,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      deviceId: result.registration.deviceId,
      token: result.deliveryToken,
      apiBaseUrl: getPublicApiBaseUrl(request),
      status: "completed",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to complete registration" },
      { status: 400 },
    );
  }
}
