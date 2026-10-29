import { describe, expect, it } from "vitest";
import {
  VOICE_THREAD_MAX_PART_CHARS,
  VOICE_THREAD_MAX_TURNS_PER_FLUSH,
  capVoiceTurnParts,
  deriveVoiceThreadTitle,
  selectVoiceTurnsToPersist,
  type VoiceSessionMessage,
} from "./session-thread-contract";

function message(
  overrides: Partial<VoiceSessionMessage> & { id: string },
): VoiceSessionMessage {
  return {
    role: "user",
    parts: [{ type: "text", text: "hello" }],
    completed: true,
    ...overrides,
  };
}

describe("selectVoiceTurnsToPersist", () => {
  it("returns completed user and assistant turns that are not stored yet", () => {
    const { turns, signatures } = selectVoiceTurnsToPersist(
      [
        message({ id: "a" }),
        message({ id: "b", role: "assistant" }),
        message({ id: "c", completed: false }),
      ],
      new Map(),
    );

    expect(turns.map((turn) => turn.id)).toEqual(["a", "b"]);
    expect(signatures.size).toBe(2);
  });

  it("skips turns whose parts have not changed since they were written", () => {
    const stored = new Map([
      ["a", JSON.stringify([{ type: "text", text: "hello" }])],
    ]);

    expect(
      selectVoiceTurnsToPersist([message({ id: "a" })], stored).turns,
    ).toEqual([]);
  });

  /**
   * A turn counts as completed as soon as a text part has any text, so one can
   * be written mid-sentence and grow afterwards. The signature is what catches
   * that; the server upserts on the id, so the grown turn replaces the stub.
   */
  it("re-sends a turn whose parts grew after it was written", () => {
    const stored = new Map([
      ["a", JSON.stringify([{ type: "text", text: "hel" }])],
    ]);

    const { turns } = selectVoiceTurnsToPersist([message({ id: "a" })], stored);
    expect(turns).toHaveLength(1);
  });

  it("ignores empty turns and roles that are not part of the conversation", () => {
    const { turns } = selectVoiceTurnsToPersist(
      [
        message({ id: "u", role: "user" }),
        message({ id: "empty", role: "assistant", parts: [] }),
        message({ id: "sys", role: "system" }),
      ],
      new Map(),
    );
    expect(turns.map((turn) => turn.id)).toEqual(["u"]);
  });

  /**
   * The model greets every session, so writing before the user speaks would
   * leave a thread behind every time the drawer is opened and closed.
   */
  it("writes nothing until the user has spoken, then keeps the greeting too", () => {
    const greeting = message({
      id: "hello",
      role: "assistant",
      parts: [{ type: "text", text: "Hallo!" }],
    });
    expect(selectVoiceTurnsToPersist([greeting], new Map()).turns).toEqual([]);

    const { turns } = selectVoiceTurnsToPersist(
      [greeting, message({ id: "first", role: "user" })],
      new Map(),
    );
    expect(turns.map((turn) => turn.id)).toEqual(["hello", "first"]);
  });

  it("caps one flush so a replayed session cannot post everything at once", () => {
    const many = Array.from(
      { length: VOICE_THREAD_MAX_TURNS_PER_FLUSH + 5 },
      (_, i) => message({ id: `m${i}` }),
    );
    const { turns } = selectVoiceTurnsToPersist(many, new Map());
    expect(turns).toHaveLength(VOICE_THREAD_MAX_TURNS_PER_FLUSH);
  });
});

describe("capVoiceTurnParts", () => {
  it("leaves an ordinary turn alone", () => {
    const parts = [{ type: "text", text: "short" }];
    expect(capVoiceTurnParts(parts)).toBe(parts);
  });

  /**
   * Unlike the realtime conversation, a chat message is stored forever and
   * re-read on every thread open, so a huge tool result is replaced rather
   * than kept. The spoken text is what the user came back for.
   */
  it("keeps the text and drops an oversized tool output", () => {
    const capped = capVoiceTurnParts([
      { type: "text", text: "here is what I found" },
      {
        type: "tool-webSearch",
        toolCallId: "call-1",
        state: "output-available",
        output: { blob: "x".repeat(VOICE_THREAD_MAX_PART_CHARS) },
      },
    ]) as { type: string; output?: { truncated?: boolean } }[];

    expect(capped[0]).toEqual({ type: "text", text: "here is what I found" });
    expect(capped[1].output?.truncated).toBe(true);
    expect(JSON.stringify(capped).length).toBeLessThan(
      VOICE_THREAD_MAX_PART_CHARS,
    );
  });
});

describe("deriveVoiceThreadTitle", () => {
  it("names the thread after the first thing the user said", () => {
    expect(
      deriveVoiceThreadTitle(
        [
          {
            id: "a",
            role: "assistant",
            parts: [{ type: "text", text: "Hi!" }],
          },
          {
            id: "b",
            role: "user",
            parts: [{ type: "text", text: "Wie ist der Stand bei Projekt X?" }],
          },
        ],
        "fallback",
      ),
    ).toBe("Wie ist der Stand bei Projekt X?");
  });

  /**
   * Never the assistant's opening line: the model greets every session the
   * same way, so every voice thread would end up with the same name.
   */
  it("falls back when the user has not spoken yet", () => {
    expect(
      deriveVoiceThreadTitle(
        [
          {
            id: "a",
            role: "assistant",
            parts: [{ type: "text", text: "Hi!" }],
          },
        ],
        "Voice conversation",
      ),
    ).toBe("Voice conversation");
  });
});
