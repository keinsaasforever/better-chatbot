import { withAuth } from "auth/route-guard";
import { voiceDeviceRepository } from "lib/db/repository";
import { ClaimDeviceRegistrationSchema } from "lib/voice/schemas";
import {
  generateDeviceToken,
  hashDeviceToken,
  hashPairingCode,
} from "lib/voice/device-token";
import { NextResponse } from "next/server";

export const POST = withAuth(async (request, session) => {
  try {
    const json = await request.json();
    const body = ClaimDeviceRegistrationSchema.parse(json);
    const codeHash = hashPairingCode(body.code);
    const registration =
      await voiceDeviceRepository.selectRegistrationByCodeHash(codeHash);

    if (!registration) {
      return NextResponse.json(
        { error: "Invalid or expired pairing code" },
        { status: 400 },
      );
    }

    if (registration.status !== "pending") {
      return NextResponse.json(
        { error: "This pairing code was already used" },
        { status: 400 },
      );
    }

    if (registration.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Invalid or expired pairing code" },
        { status: 400 },
      );
    }

    const organizationId =
      (session.session as { activeOrganizationId?: string } | undefined)
        ?.activeOrganizationId ?? null;
    const displayName =
      body.displayName?.trim() || registration.displayName || "Atom EchoS3R";
    const token = generateDeviceToken();

    const device = await voiceDeviceRepository.createDevice({
      userId: session.user.id,
      organizationId,
      deviceType: registration.deviceType,
      displayName,
      tokenHash: hashDeviceToken(token),
      firmwareVersion: registration.firmwareVersion,
    });

    const claimed = await voiceDeviceRepository.claimDeviceRegistration({
      registrationId: registration.id,
      userId: session.user.id,
      organizationId,
      displayName,
      deviceId: device.id,
      deliveryToken: token,
    });

    if (!claimed) {
      return NextResponse.json(
        { error: "Could not claim device registration" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      registrationId: claimed.id,
      deviceId: device.id,
      displayName: device.displayName,
      status: "claimed",
      message:
        "Device linked to your account. It will receive credentials automatically once Wi-Fi setup completes.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to claim device" },
      { status: 400 },
    );
  }
});
