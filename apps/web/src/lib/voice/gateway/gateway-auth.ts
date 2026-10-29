import { NextResponse } from "next/server";

export function authenticateVoiceGateway(request: Request) {
  const expected = process.env.VOICE_GATEWAY_SERVICE_TOKEN;
  if (!expected) {
    throw new Error("VOICE_GATEWAY_SERVICE_TOKEN is not configured");
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  return token.length > 0 && token === expected;
}

export function unauthorizedGatewayResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
