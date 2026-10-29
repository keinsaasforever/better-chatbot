import { withAuth } from "auth/route-guard";
import { VoiceDeviceSummary } from "app-types/voice-device";
import { voiceDeviceRepository } from "lib/db/repository";
import {
  formatLastSeen,
  getVoiceDeviceConnectionStatus,
} from "lib/voice/device-online";
import { NextResponse } from "next/server";

export const GET = withAuth(async (request, session) => {
  try {
    const registrationId = new URL(request.url).searchParams.get(
      "registrationId",
    );
    if (!registrationId) {
      return NextResponse.json(
        { error: "registrationId is required" },
        { status: 400 },
      );
    }

    const registration =
      await voiceDeviceRepository.selectRegistrationById(registrationId);
    if (!registration || registration.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let device: VoiceDeviceSummary | null = null;
    if (registration.deviceId) {
      device = await voiceDeviceRepository.selectByIdForUser(
        registration.deviceId,
        session.user.id,
      );
    }

    const connectionStatus = device
      ? getVoiceDeviceConnectionStatus(device.lastSeenAt, device.status)
      : "never_connected";

    return NextResponse.json({
      registrationId: registration.id,
      registrationStatus: registration.status,
      deviceId: registration.deviceId,
      displayName: registration.displayName,
      connectionStatus,
      lastSeenAt: device?.lastSeenAt?.toISOString() ?? null,
      lastSeenLabel: device ? formatLastSeen(device.lastSeenAt) : null,
      isOnline: connectionStatus === "online",
      isComplete: registration.status === "completed",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to load setup status" },
      { status: 500 },
    );
  }
});
