import { createHash, randomBytes, randomInt } from "node:crypto";

const DEVICE_TOKEN_PREFIX = "nvdev_live_";

export function getVoiceDeviceTokenPepper(): string {
  const pepper = process.env.VOICE_DEVICE_TOKEN_PEPPER;
  if (!pepper) {
    throw new Error("VOICE_DEVICE_TOKEN_PEPPER is not configured");
  }
  return pepper;
}

export function hashDeviceToken(token: string): string {
  const pepper = getVoiceDeviceTokenPepper();
  return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

export function hashPairingCode(code: string): string {
  const pepper = getVoiceDeviceTokenPepper();
  return createHash("sha256").update(`${pepper}:pair:${code}`).digest("hex");
}

export function generateDeviceToken(): string {
  return `${DEVICE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function generatePairingCode(): string {
  return String(randomInt(100000, 1000000));
}

export function isValidDeviceToken(token: string): boolean {
  return (
    token.startsWith(DEVICE_TOKEN_PREFIX) &&
    token.length > DEVICE_TOKEN_PREFIX.length
  );
}

export function getBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}
