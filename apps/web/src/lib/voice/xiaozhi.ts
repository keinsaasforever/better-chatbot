import { getPublicApiBaseUrl } from "lib/voice/device-auth";

export const XIAOZHI_PROTOCOL_VERSION = 1;
export const XIAOZHI_FIRMWARE_VERSION = "0.1.0";

export function getXiaozhiHardwareId(request: Request): string | null {
  const deviceId = request.headers.get("device-id")?.trim();
  if (deviceId) return deviceId.slice(0, 64);

  const clientId = request.headers.get("client-id")?.trim();
  if (clientId) return clientId.slice(0, 64);

  return null;
}

export function getXiaozhiFirmwareVersion(request: Request): string {
  const userAgent = request.headers.get("user-agent")?.trim();
  if (!userAgent) return XIAOZHI_FIRMWARE_VERSION;

  const version = userAgent.split("/").at(-1)?.trim();
  if (!version || version.length > 40) return XIAOZHI_FIRMWARE_VERSION;

  return version;
}

export function getXiaozhiWebSocketUrl(request: Request): string {
  const configured = process.env.VOICE_DEVICE_WS_URL?.trim();
  if (configured) {
    return configured;
  }

  const baseUrl = getPublicApiBaseUrl(request);
  const wsBaseUrl = baseUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return `${wsBaseUrl}/api/voice/devices/ws`;
}

export function createXiaozhiWebSocketConfig(request: Request, token: string) {
  return {
    url: getXiaozhiWebSocketUrl(request),
    token,
    version: XIAOZHI_PROTOCOL_VERSION,
  };
}

export function createXiaozhiServerTime() {
  return {
    timestamp: Date.now(),
    timezone_offset: 0,
  };
}

export function createXiaozhiFirmwareInfo() {
  return {
    version: XIAOZHI_FIRMWARE_VERSION,
  };
}
