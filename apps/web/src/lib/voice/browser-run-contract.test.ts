import { describe, expect, it } from "vitest";
import {
  encodeVoiceBrowserFrame,
  isVoiceBrowserFrameFinal,
  parseVoiceBrowserFrame,
  splitFrameLines,
  VOICE_BROWSER_CHECK_TIMEOUT_MS,
  VOICE_BROWSER_MAX_RUN_MS,
  type VoiceBrowserFrame,
} from "./browser-run-contract";

describe("voice browser frame encoding", () => {
  it("writes one newline-terminated JSON object per frame", () => {
    const line = encodeVoiceBrowserFrame({
      status: "starting",
      sessionId: "s1",
      liveViewUrl: "https://live/1",
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      status: "starting",
      sessionId: "s1",
      liveViewUrl: "https://live/1",
    });
  });

  it("round-trips every frame shape", () => {
    const frames: VoiceBrowserFrame[] = [
      { status: "starting", sessionId: "s", liveViewUrl: "u" },
      { status: "running", sessionId: "s", liveViewUrl: "u", stepCount: 3 },
      {
        status: "done",
        sessionId: "s",
        liveViewUrl: "u",
        summary: "found it",
        stepCount: 4,
      },
      {
        status: "blocked",
        sessionId: "s",
        reason: "one-time code",
        summary: "got to sign-in",
        stepCount: 2,
      },
      { status: "failed", error: "boom" },
    ];
    for (const frame of frames) {
      expect(parseVoiceBrowserFrame(encodeVoiceBrowserFrame(frame))).toEqual(
        frame,
      );
    }
  });
});

/**
 * Getting this wrong shows up as an occasional dropped terminal frame, which
 * leaves the model waiting on a run that has already finished — miserable to
 * reproduce against a live browser, trivial to pin down here.
 */
describe("frame line splitting", () => {
  it("keeps a partial trailing frame for the next chunk", () => {
    const { lines, rest } = splitFrameLines('{"a":1}\n{"b":');
    expect(lines).toEqual(['{"a":1}']);
    expect(rest).toBe('{"b":');
  });

  it("returns no leftover when the buffer ends on a newline", () => {
    const { lines, rest } = splitFrameLines('{"a":1}\n{"b":2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe("");
  });

  it("reassembles a frame split across two chunks", () => {
    const first = splitFrameLines('{"status":"star');
    expect(first.lines).toEqual([]);
    const second = splitFrameLines(
      `${first.rest}ting","sessionId":"s","liveViewUrl":"u"}\n`,
    );
    expect(second.lines).toHaveLength(1);
    expect(parseVoiceBrowserFrame(second.lines[0])).toEqual({
      status: "starting",
      sessionId: "s",
      liveViewUrl: "u",
    });
  });

  it("ignores blank lines", () => {
    expect(splitFrameLines('\n\n{"a":1}\n').lines).toEqual(['{"a":1}']);
  });
});

describe("frame parsing", () => {
  it("returns null rather than throwing on malformed input", () => {
    expect(parseVoiceBrowserFrame("not json")).toBeNull();
    expect(parseVoiceBrowserFrame("null")).toBeNull();
    expect(parseVoiceBrowserFrame("[1,2]")).toBeNull();
  });

  it("rejects an object with an unknown status", () => {
    expect(parseVoiceBrowserFrame('{"status":"awaiting-user"}')).toBeNull();
    expect(parseVoiceBrowserFrame('{"sessionId":"s"}')).toBeNull();
  });
});

describe("terminal frames", () => {
  it("treats done, blocked and failed as the end of the run", () => {
    expect(
      isVoiceBrowserFrameFinal({
        status: "done",
        sessionId: "s",
        liveViewUrl: "u",
        summary: "",
        stepCount: 0,
      }),
    ).toBe(true);
    expect(
      isVoiceBrowserFrameFinal({
        status: "blocked",
        sessionId: "s",
        reason: "",
        summary: "",
        stepCount: 0,
      }),
    ).toBe(true);
    expect(isVoiceBrowserFrameFinal({ status: "failed", error: "" })).toBe(
      true,
    );
  });

  it("does not treat progress frames as the end", () => {
    expect(
      isVoiceBrowserFrameFinal({
        status: "starting",
        sessionId: "s",
        liveViewUrl: "u",
      }),
    ).toBe(false);
    expect(
      isVoiceBrowserFrameFinal({
        status: "running",
        sessionId: "s",
        liveViewUrl: "u",
        stepCount: 1,
      }),
    ).toBe(false);
  });
});

describe("run budgets", () => {
  /**
   * The check has to give up BEFORE the run does, or the model's poll outlives
   * the thing it is polling and it never gets a chance to say "still working".
   */
  it("gives up on a check sooner than the run itself can end", () => {
    expect(VOICE_BROWSER_CHECK_TIMEOUT_MS).toBeLessThan(
      VOICE_BROWSER_MAX_RUN_MS,
    );
  });
});
