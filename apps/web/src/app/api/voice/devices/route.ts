import { withAuth } from "auth/route-guard";
import { voiceDeviceRepository } from "lib/db/repository";
import { NextResponse } from "next/server";

export const GET = withAuth(async (_request, session) => {
  try {
    const devices = await voiceDeviceRepository.listByUserId(session.user.id);
    return NextResponse.json({ devices });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to list voice devices" },
      { status: 500 },
    );
  }
});
