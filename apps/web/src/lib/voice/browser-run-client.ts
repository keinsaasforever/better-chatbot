"use client";

import {
  isVoiceBrowserFrameFinal,
  parseVoiceBrowserFrame,
  splitFrameLines,
  type VoiceBrowserFrame,
} from "./browser-run-contract";

/**
 * Client half of a voice browser run.
 *
 * Kept out of `use-voice-chat.openai.ts` because the shape is the whole point
 * and it is worth reading on its own: ONE request produces TWO answers at
 * different times.
 *
 * - `first` settles as soon as the browser exists (a couple of seconds). That
 *   is what the `browseWeb` function call returns, so the realtime model can
 *   say "I've opened the browser" instead of going mute for the whole run.
 * - `final` settles when the run is over, and is what `checkBrowserRun`
 *   awaits.
 *
 * Everything in between goes to `onFrame`, which drives the live-view panel.
 */

export type VoiceBrowserRun = {
  /** The frame that opened the run: `starting`, or a terminal `failed`. */
  first: VoiceBrowserFrame;
  /** Resolves with the terminal frame. Never rejects. */
  final: Promise<VoiceBrowserFrame>;
};

/** Thrown when the run could not be started at all (403, 402, network). */
export class VoiceBrowserRunError extends Error {}

export async function startVoiceBrowserRun(input: {
  task: string;
  callId: string;
  onFrame: (frame: VoiceBrowserFrame) => void;
  signal?: AbortSignal;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}): Promise<VoiceBrowserRun> {
  const doFetch = input.fetchImpl ?? fetch;
  const response = await doFetch("/api/voice/browser-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: input.task, callId: input.callId }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    // The route answers a refusal as ordinary JSON precisely so this reads as
    // a message the model can relay, not a stream that dies immediately.
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new VoiceBrowserRunError(
      payload?.error ?? "The browser could not be started.",
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let resolveFirst!: (frame: VoiceBrowserFrame) => void;
  let rejectFirst!: (error: Error) => void;
  const firstPromise = new Promise<VoiceBrowserFrame>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });

  let resolveFinal!: (frame: VoiceBrowserFrame) => void;
  const final = new Promise<VoiceBrowserFrame>((resolve) => {
    resolveFinal = resolve;
  });

  let sawFirst = false;
  let settledFinal = false;
  const settleFinal = (frame: VoiceBrowserFrame) => {
    if (settledFinal) return;
    settledFinal = true;
    // A run that dies before its first frame still has to answer the function
    // call, or the realtime conversation waits on it forever.
    if (!sawFirst) {
      sawFirst = true;
      rejectFirst(new VoiceBrowserRunError(errorTextOf(frame)));
    }
    input.onFrame(frame);
    resolveFinal(frame);
  };

  void (async () => {
    let buffer = "";
    let lastSessionId: string | undefined;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines, rest } = splitFrameLines(buffer);
        buffer = rest;
        for (const line of lines) {
          const frame = parseVoiceBrowserFrame(line);
          if (!frame) continue;
          if ("sessionId" in frame && frame.sessionId) {
            lastSessionId = frame.sessionId;
          }
          if (isVoiceBrowserFrameFinal(frame)) {
            settleFinal(frame);
            return;
          }
          input.onFrame(frame);
          if (!sawFirst) {
            sawFirst = true;
            resolveFirst(frame);
          }
        }
      }
      // The body ended without a terminal frame: the function timed out, the
      // connection dropped, or a proxy cut it. The browser is gone either way
      // (the tool's `finally` tears it down server-side), so this is a failure.
      settleFinal({
        status: "failed",
        ...(lastSessionId ? { sessionId: lastSessionId } : {}),
        error: "The browser run ended without finishing.",
      });
    } catch {
      settleFinal({
        status: "failed",
        ...(lastSessionId ? { sessionId: lastSessionId } : {}),
        error: "Lost the connection to the browser run.",
      });
    }
  })();

  return { first: await firstPromise, final };
}

function errorTextOf(frame: VoiceBrowserFrame): string {
  if (frame.status === "failed") return frame.error;
  if (frame.status === "blocked") return frame.reason;
  return "The browser run ended.";
}
