"use client";

import type { VoiceSessionThreadRequest } from "./session-thread-contract";

/**
 * POST one batch of voice turns to be filed into the session's chat thread.
 *
 * Returns whether the write landed. Never throws: this runs alongside a live
 * conversation, and a failed background save must not take the session down —
 * the caller keeps the turns unsent and tries again on the next flush.
 */
export async function flushVoiceSessionTurns(
  request: VoiceSessionThreadRequest,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch("/api/voice/session-thread", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
      // The last flush is fired from a teardown path, where a normal fetch is
      // cancelled when the page goes away. `keepalive` lets it finish.
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}
