/**
 * The credit-exhaustion code every AI entry point returns with its 402.
 * The server-side credit guard is the authoritative gate; the client only
 * needs to recognise its verdict.
 */
const CREDITS_EXHAUSTED_CODE = "CREDITS_EXHAUSTED";

/**
 * True when `error` is the server refusing because the workspace has spent its
 * allowance, rather than a genuine failure.
 *
 * `useChat` surfaces a non-ok response by putting the raw body in
 * `error.message`, and the routes do not agree on a shape: `/api/chat` returns
 * `{ code, message, retryable }` while `/api/chat/temporary` and
 * `/api/agent/ai` return `{ error, code }`. Both carry `code`, so parse and
 * read that; fall back to a substring test for a body that is not JSON (a
 * proxy error page, a truncated stream).
 */
export function isCreditsExhaustedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { message } = error as { message?: unknown };
  if (typeof message !== "string") return false;

  try {
    const body = JSON.parse(message) as { code?: unknown };
    if (body && typeof body === "object") {
      return body.code === CREDITS_EXHAUSTED_CODE;
    }
  } catch {
    // Not JSON — fall through to the substring check below.
  }

  return message.includes(CREDITS_EXHAUSTED_CODE);
}
