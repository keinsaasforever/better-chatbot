/**
 * Normalise a user-supplied `callbackUrl` to a safe, same-origin relative path.
 * Prevents open-redirects: only in-app paths (single leading "/", no "//" or
 * "/\\") are accepted; anything else returns undefined.
 */
export function sanitizeCallbackUrl(
  value: string | string[] | undefined | null,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  if (!raw.startsWith("/")) return undefined;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
  return raw;
}

/** Build a `?callbackUrl=…` query suffix (or "") for an auth link. */
export function callbackUrlQuery(callbackUrl: string | undefined): string {
  return callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : "";
}
