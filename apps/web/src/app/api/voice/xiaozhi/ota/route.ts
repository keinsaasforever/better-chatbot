import { voiceDeviceRepository } from "lib/db/repository";
import { authenticateVoiceDevice } from "lib/voice/device-auth";
import {
  generatePairingCode,
  getBearerToken,
  getVoiceDeviceTokenPepper,
  hashPairingCode,
} from "lib/voice/device-token";
import { PAIRING_CODE_TTL_MS } from "lib/voice/types";
import {
  createXiaozhiFirmwareInfo,
  createXiaozhiServerTime,
  createXiaozhiWebSocketConfig,
  getXiaozhiFirmwareVersion,
  getXiaozhiHardwareId,
} from "lib/voice/xiaozhi";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

async function handleOta(request: Request) {
  try {
    getVoiceDeviceTokenPepper();
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const token = getBearerToken(request);
  if (token) {
    const actor = await authenticateVoiceDevice(request);
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      websocket: createXiaozhiWebSocketConfig(request, token),
      server_time: createXiaozhiServerTime(),
      firmware: createXiaozhiFirmwareInfo(),
    });
  }

  const hardwareId = getXiaozhiHardwareId(request);
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  const registration = await voiceDeviceRepository.createDeviceRegistration({
    codeHash: hashPairingCode(code),
    deviceType: "m5stack_atom_echo_s3r",
    firmwareVersion: getXiaozhiFirmwareVersion(request),
    hardwareId,
    expiresAt,
  });

  return NextResponse.json({
    activation: {
      message: "Enter this code in Navigator Voice devices",
      code,
      challenge: registration.id,
      timeout_ms: PAIRING_CODE_TTL_MS,
    },
    server_time: createXiaozhiServerTime(),
    firmware: createXiaozhiFirmwareInfo(),
  });
}

export async function POST(request: Request) {
  try {
    return await handleOta(request);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to handle xiaozhi OTA" },
      { status: 400 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
