import { voiceDeviceRepository } from "lib/db/repository";
import {
  getVoiceDeviceTokenPepper,
  hashPairingCode,
} from "lib/voice/device-token";
import { CompleteDeviceRegistrationSchema } from "lib/voice/schemas";
import {
  createXiaozhiFirmwareInfo,
  createXiaozhiServerTime,
  createXiaozhiWebSocketConfig,
  getXiaozhiHardwareId,
} from "lib/voice/xiaozhi";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const XiaozhiActivationSchema = z
  .object({
    challenge: z.string().uuid(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .transform((value) => ({
    registrationId: value.challenge,
    code: value.code,
  }))
  .pipe(CompleteDeviceRegistrationSchema);

export async function POST(request: Request) {
  try {
    getVoiceDeviceTokenPepper();
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    const body = XiaozhiActivationSchema.parse(await request.json());
    const registration = await voiceDeviceRepository.selectRegistrationById(
      body.registrationId,
    );

    if (!registration) {
      return NextResponse.json(
        { error: "Activation not found" },
        { status: 404 },
      );
    }

    if (registration.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Activation expired" },
        { status: 410 },
      );
    }

    const hardwareId = getXiaozhiHardwareId(request);
    if (
      registration.hardwareId &&
      hardwareId &&
      registration.hardwareId !== hardwareId
    ) {
      return NextResponse.json(
        { error: "Activation hardware mismatch" },
        { status: 403 },
      );
    }

    if (registration.status === "pending") {
      return NextResponse.json({ status: "pending" }, { status: 202 });
    }

    if (registration.status === "completed") {
      return NextResponse.json({
        status: "completed",
        deviceId: registration.deviceId,
        server_time: createXiaozhiServerTime(),
        firmware: createXiaozhiFirmwareInfo(),
      });
    }

    if (registration.status !== "claimed") {
      return NextResponse.json(
        { error: `Activation is ${registration.status}` },
        { status: 400 },
      );
    }

    const result = await voiceDeviceRepository.completeDeviceRegistration({
      registrationId: body.registrationId,
      codeHash: hashPairingCode(body.code),
    });

    if (!result) {
      return NextResponse.json(
        { error: "Activation not ready or already completed" },
        { status: 400 },
      );
    }

    return NextResponse.json({
      status: "completed",
      deviceId: result.registration.deviceId,
      websocket: createXiaozhiWebSocketConfig(request, result.deliveryToken),
      server_time: createXiaozhiServerTime(),
      firmware: createXiaozhiFirmwareInfo(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to activate xiaozhi device" },
      { status: 400 },
    );
  }
}
