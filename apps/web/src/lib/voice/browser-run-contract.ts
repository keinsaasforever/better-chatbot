/**
 * Wire format between the voice browser run and the voice client.
 *
 * Deliberately free of `server-only` and of any Kernel or AI SDK import, the
 * same way `lib/kernel/browser-contract.ts` is: the voice hook and the preview
 * panel both import these, and the framing is worth unit-testing without
 * standing up a browser.
 *
 * Why a stream at all, when every other voice tool is a plain POST to
 * `/api/voice/tool`: the browser tool's FIRST yield carries the live-view URL,
 * and the run then takes 30-120s. A single request/response would leave the
 * panel blank until the run ended and the voice session mute throughout, which
 * reads as broken. So the run streams, the tool call returns on the first
 * frame, and the model can speak while the browser works.
 *
 * NDJSON rather than SSE: `EventSource` cannot POST and carries no auth, so
 * this is a plain `fetch` streaming a body either way, and SSE's `event:`/`id:`
 * framing would buy nothing over one JSON object per line.
 */

/** `Content-Type` for the run stream. */
export const VOICE_BROWSER_STREAM_CONTENT_TYPE = "application/x-ndjson";

/**
 * Wall-clock ceiling on one browser run started by voice.
 *
 * A cost guard. Interactive chat runs are uncapped because the user is looking
 * at a thread and can stop one; a voice user's attention is on audio, starting
 * a run costs them one sentence, and a headful Kernel browser bills 128 credits
 * per second. Three minutes is enough for a sign-in plus real work.
 */
export const VOICE_BROWSER_MAX_RUN_MS = 3 * 60 * 1000;

/**
 * How long `checkBrowserRun` waits before answering "still going".
 *
 * Shorter than the run cap on purpose: the model gets a chance to say something
 * reassuring rather than sitting silent for the whole run, and can call again.
 */
export const VOICE_BROWSER_CHECK_TIMEOUT_MS = 60 * 1000;

/**
 * One frame of a voice browser run.
 *
 * Mirrors `BrowserToolOutput` from `lib/kernel/browser-contract.ts` with two
 * deliberate differences:
 *
 * - `running` carries a `stepCount` instead of the inner agent's whole
 *   `UIMessage`. The chat panel renders that message; the voice panel shows a
 *   live view and a step count, so shipping the full transcript on every step
 *   would be bandwidth and inner-agent detail the client has no use for.
 * - The legacy `awaiting-user` state is absent. Nothing produces it any more,
 *   and voice has no history of parked runs to render.
 */
export type VoiceBrowserFrame =
  | { status: "starting"; sessionId: string; liveViewUrl: string }
  | {
      status: "running";
      sessionId: string;
      liveViewUrl: string;
      stepCount: number;
    }
  | {
      status: "done";
      sessionId: string;
      liveViewUrl: string;
      summary: string;
      stepCount: number;
    }
  | {
      status: "blocked";
      sessionId: string;
      liveViewUrl?: string;
      reason: string;
      summary: string;
      stepCount: number;
    }
  | { status: "failed"; sessionId?: string; error: string };

/** Terminal frames, i.e. the browser is gone and no more frames will arrive. */
export function isVoiceBrowserFrameFinal(frame: VoiceBrowserFrame): boolean {
  return (
    frame.status === "done" ||
    frame.status === "blocked" ||
    frame.status === "failed"
  );
}

/** One frame as a line of the response body. */
export function encodeVoiceBrowserFrame(frame: VoiceBrowserFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/**
 * Split a decoded chunk into whole lines, keeping any trailing partial.
 *
 * A frame can straddle a chunk boundary, so the caller carries `rest` into the
 * next call. Pulled out as a pure function because getting this wrong shows up
 * as an occasional dropped terminal frame, which is exactly the bug that is
 * miserable to reproduce against a live browser.
 */
export function splitFrameLines(buffer: string): {
  lines: string[];
  rest: string;
} {
  const parts = buffer.split("\n");
  // The last element is whatever followed the final newline: "" when the buffer
  // ended cleanly, a partial frame otherwise. Either way it is not a whole line.
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((line) => line.trim().length > 0), rest };
}

/**
 * Parse one line, or `null` when it is not a frame.
 *
 * Never throws: a malformed line is a bug on our side of a channel we own, but
 * throwing here would take down a run that is otherwise fine, and the caller
 * already treats "stream ended with no terminal frame" as a failure.
 */
export function parseVoiceBrowserFrame(line: string): VoiceBrowserFrame | null {
  try {
    const value = JSON.parse(line) as unknown;
    if (typeof value !== "object" || value === null) return null;
    const status = (value as { status?: unknown }).status;
    if (
      status !== "starting" &&
      status !== "running" &&
      status !== "done" &&
      status !== "blocked" &&
      status !== "failed"
    ) {
      return null;
    }
    return value as VoiceBrowserFrame;
  } catch {
    return null;
  }
}
