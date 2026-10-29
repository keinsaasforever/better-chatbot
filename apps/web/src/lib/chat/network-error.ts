/**
 * Transport-level failures the browser raises when a request is torn down
 * before it finished — the tab was frozen or backgrounded (iOS Safari), the
 * network dropped, or the request was aborted. They carry no server detail:
 * the message is the browser's own wording, so it must never be shown raw.
 *
 * Compared against the trimmed, lower-cased message with a trailing period
 * removed. Matching exact strings rather than substrings keeps a genuine
 * server error that happens to mention fetching ("Failed to fetch the
 * document", a tool error) out of this bucket.
 */
const NETWORK_ERROR_MESSAGES = new Set([
  // WebKit / iOS Safari
  "load failed",
  "the network connection was lost",
  "the internet connection appears to be offline",
  // Chromium
  "failed to fetch",
  // Firefox
  "networkerror when attempting to fetch resource",
  "network request failed",
]);

/**
 * True when `error` is a connection-layer failure rather than a server
 * response. Callers should render a translated notice instead of
 * `error.message` (but still log the original).
 */
export function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  // A torn-down or timed-out fetch rejects with a DOMException, whose message
  // varies by browser and locale — the name is the reliable signal.
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (typeof message !== "string") return false;
  return NETWORK_ERROR_MESSAGES.has(
    message.trim().toLowerCase().replace(/\.$/, ""),
  );
}
