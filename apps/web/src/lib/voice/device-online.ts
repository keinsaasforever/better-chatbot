const ONLINE_THRESHOLD_MS = 5 * 60 * 1000;

export type VoiceDeviceConnectionStatus =
  | "online"
  | "offline"
  | "never_connected";

export function getVoiceDeviceConnectionStatus(
  lastSeenAt: Date | string | null | undefined,
  status: "active" | "revoked",
): VoiceDeviceConnectionStatus {
  if (status === "revoked") {
    return "offline";
  }
  if (!lastSeenAt) {
    return "never_connected";
  }
  const seenAt =
    typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  if (Number.isNaN(seenAt.getTime())) {
    return "never_connected";
  }
  return Date.now() - seenAt.getTime() <= ONLINE_THRESHOLD_MS
    ? "online"
    : "offline";
}

export function formatLastSeen(
  lastSeenAt: Date | string | null,
): string | null {
  if (!lastSeenAt) return null;
  const seenAt =
    typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  if (Number.isNaN(seenAt.getTime())) return null;
  const diffMs = Date.now() - seenAt.getTime();
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
