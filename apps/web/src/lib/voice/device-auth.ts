import { voiceDeviceRepository } from "lib/db/repository";
import { userRepository } from "lib/db/repository";
import {
  getBearerToken,
  hashDeviceToken,
  isValidDeviceToken,
} from "./device-token";
import { VoiceActor } from "./types";

export type AuthenticatedVoiceDevice = VoiceActor & {
  deviceDisplayName: string;
};

export async function authenticateVoiceDevice(
  request: Request,
): Promise<AuthenticatedVoiceDevice | null> {
  const token = getBearerToken(request);
  if (!token || !isValidDeviceToken(token)) {
    return null;
  }

  const tokenHash = hashDeviceToken(token);
  const device = await voiceDeviceRepository.selectByTokenHash(tokenHash);
  if (!device || device.status !== "active") {
    return null;
  }

  const user = await userRepository.getUserById(device.userId);
  if (!user) {
    return null;
  }

  await voiceDeviceRepository.touchLastSeen(device.id);

  return {
    userId: device.userId,
    organizationId: device.organizationId,
    source: "m5stack",
    deviceId: device.id,
    deviceDisplayName: device.displayName,
  };
}

export function getPublicApiBaseUrl(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  const url = new URL(request.url);
  return url.origin;
}
