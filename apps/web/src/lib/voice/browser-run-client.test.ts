import { describe, expect, it, vi } from "vitest";
import {
  startVoiceBrowserRun,
  VoiceBrowserRunError,
} from "./browser-run-client";
import {
  encodeVoiceBrowserFrame,
  type VoiceBrowserFrame,
} from "./browser-run-contract";

/**
 * A response whose body emits `chunks` in order, so a test can control exactly
 * where a frame is split and when the stream ends.
 */
function streamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const STARTING: VoiceBrowserFrame = {
  status: "starting",
  sessionId: "sess-1",
  liveViewUrl: "https://live/1?readOnly=true",
};
const DONE: VoiceBrowserFrame = {
  status: "done",
  sessionId: "sess-1",
  liveViewUrl: "https://live/1?readOnly=true",
  summary: "Three invoices are unpaid.",
  stepCount: 5,
};

describe("startVoiceBrowserRun", () => {
  /**
   * The whole reason this streams: the function call has to be answerable
   * within seconds so the model can speak, while the run keeps going for a
   * minute or more.
   */
  it("resolves on the first frame without waiting for the run to finish", async () => {
    let releaseRest!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseRest = resolve;
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(encodeVoiceBrowserFrame(STARTING)));
        await gate;
        controller.enqueue(encoder.encode(encodeVoiceBrowserFrame(DONE)));
        controller.close();
      },
    });

    const run = await startVoiceBrowserRun({
      task: "check invoices",
      callId: "call-1",
      onFrame: () => {},
      fetchImpl: async () => new Response(body, { status: 200 }),
    });

    expect(run.first).toEqual(STARTING);

    releaseRest();
    expect(await run.final).toEqual(DONE);
  });

  it("reports every frame to onFrame, terminal one included", async () => {
    const seen: VoiceBrowserFrame[] = [];
    const running: VoiceBrowserFrame = {
      status: "running",
      sessionId: "sess-1",
      liveViewUrl: "https://live/1?readOnly=true",
      stepCount: 2,
    };
    const run = await startVoiceBrowserRun({
      task: "t",
      callId: "c",
      onFrame: (frame) => seen.push(frame),
      fetchImpl: async () =>
        streamingResponse([
          encodeVoiceBrowserFrame(STARTING),
          encodeVoiceBrowserFrame(running),
          encodeVoiceBrowserFrame(DONE),
        ]),
    });

    await run.final;
    expect(seen).toEqual([STARTING, running, DONE]);
  });

  it("reassembles a frame split across chunk boundaries", async () => {
    const line = encodeVoiceBrowserFrame(STARTING);
    const run = await startVoiceBrowserRun({
      task: "t",
      callId: "c",
      onFrame: () => {},
      fetchImpl: async () =>
        streamingResponse([
          line.slice(0, 12),
          line.slice(12),
          encodeVoiceBrowserFrame(DONE),
        ]),
    });
    expect(run.first).toEqual(STARTING);
    expect(await run.final).toEqual(DONE);
  });

  /**
   * A function timeout or a proxy cutting the body looks exactly like this.
   * The browser is gone server-side either way, so the run must not be left
   * pending — that would hang `checkBrowserRun` until its own timeout.
   */
  it("fails the run when the stream ends with no terminal frame", async () => {
    const run = await startVoiceBrowserRun({
      task: "t",
      callId: "c",
      onFrame: () => {},
      fetchImpl: async () =>
        streamingResponse([encodeVoiceBrowserFrame(STARTING)]),
    });

    const final = await run.final;
    expect(final.status).toBe("failed");
    expect(final).toMatchObject({ sessionId: "sess-1" });
  });

  it("rejects when the run refuses before any frame", async () => {
    await expect(
      startVoiceBrowserRun({
        task: "t",
        callId: "c",
        onFrame: () => {},
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: "Browser automation is not available for this workspace.",
            }),
            { status: 403 },
          ),
      }),
    ).rejects.toBeInstanceOf(VoiceBrowserRunError);
  });

  it("surfaces a first frame that is already terminal", async () => {
    const failed: VoiceBrowserFrame = {
      status: "failed",
      error: "Could not start a browser",
    };
    const onFrame = vi.fn();
    await expect(
      startVoiceBrowserRun({
        task: "t",
        callId: "c",
        onFrame,
        fetchImpl: async () =>
          streamingResponse([encodeVoiceBrowserFrame(failed)]),
      }),
    ).rejects.toThrow("Could not start a browser");
    expect(onFrame).toHaveBeenCalledWith(failed);
  });

  /**
   * `callId` is the realtime function call id and doubles as the billing
   * `runId`, so losing it would make Kernel usage un-attributable.
   */
  it("posts the task and the call id", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        streamingResponse([
          encodeVoiceBrowserFrame(STARTING),
          encodeVoiceBrowserFrame(DONE),
        ]),
    );
    await startVoiceBrowserRun({
      task: "open the portal",
      callId: "call-42",
      onFrame: () => {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/voice/browser-run");
    expect(JSON.parse(String(init?.body))).toEqual({
      task: "open the portal",
      callId: "call-42",
    });
  });
});
