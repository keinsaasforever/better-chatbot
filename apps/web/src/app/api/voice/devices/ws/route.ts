import { authenticateVoiceDevice } from "lib/voice/device-auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const actor = await authenticateVoiceDevice(request);
  if (!actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: "WebSocket upgrade required",
      nextStep:
        "Run pnpm voice:bridge and set VOICE_DEVICE_WS_URL to that bridge URL.",
    },
    { status: 426 },
  );
}
