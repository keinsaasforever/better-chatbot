import { describe, expect, it } from "vitest";
import { mergeTodos, normalizeTodoKey } from "./merge-todos";

const proposed = (
  key: string,
  extra: Partial<Parameters<typeof mergeTodos>[1][number]> = {},
) => ({
  key,
  title: `Todo ${key}`,
  priority: "normal" as const,
  notify: false,
  ...extra,
});

describe("normalizeTodoKey", () => {
  it("lowercases, collapses separators and trims to 80 chars", () => {
    expect(normalizeTodoKey("  Send Deck to Alex!  ")).toBe(
      "send-deck-to-alex",
    );
    expect(normalizeTodoKey("Send-Deck")).toBe("send-deck");
    expect(normalizeTodoKey("send_deck")).toBe("send_deck");
    expect(normalizeTodoKey("x".repeat(120))).toHaveLength(80);
  });
});

describe("mergeTodos", () => {
  it("inserts new keys and notifies only the flagged ones", () => {
    const result = mergeTodos(
      [],
      [proposed("a", { notify: true }), proposed("b")],
    );

    expect(result.insert.map((t) => t.key)).toEqual(["a", "b"]);
    expect(result.notifyKeys).toEqual(["a"]);
    expect(result.update).toEqual([]);
    expect(result.close).toEqual([]);
  });

  it("updates an open row and notifies it once the model flags it", () => {
    const existing = [
      { id: "1", key: "a", status: "open" as const, notifiedAt: null },
    ];

    const first = mergeTodos(existing, [
      proposed("a", { notify: true, title: "Renamed" }),
    ]);
    expect(first.update).toEqual([
      expect.objectContaining({ id: "1", key: "a", title: "Renamed" }),
    ]);
    expect(first.notifyKeys).toEqual(["a"]);

    const alreadyNotified = mergeTodos(
      [{ ...existing[0], notifiedAt: new Date() }],
      [proposed("a", { notify: true })],
    );
    expect(alreadyNotified.notifyKeys).toEqual([]);
  });

  it("never reopens or notifies done and dismissed rows", () => {
    const result = mergeTodos(
      [
        { id: "1", key: "done-one", status: "done", notifiedAt: null },
        { id: "2", key: "gone", status: "dismissed", notifiedAt: null },
      ],
      [
        proposed("done-one", { notify: true }),
        proposed("gone", { notify: true }),
      ],
    );

    expect(result.insert).toEqual([]);
    expect(result.update).toEqual([]);
    expect(result.notifyKeys).toEqual([]);
  });

  it("closes open rows named in resolvedKeys but not rows the model still proposes", () => {
    const result = mergeTodos(
      [
        { id: "1", key: "finished", status: "open", notifiedAt: null },
        { id: "2", key: "still-open", status: "open", notifiedAt: null },
        { id: "3", key: "user-done", status: "done", notifiedAt: null },
      ],
      [proposed("still-open")],
      ["finished", "still-open", "user-done", "unknown"],
    );

    expect(result.close).toEqual(["1"]);
  });

  it("dedupes proposed items that normalise to the same key", () => {
    const result = mergeTodos(
      [],
      [proposed("Send Deck"), proposed("send-deck")],
    );

    expect(result.insert).toHaveLength(1);
    expect(result.insert[0].key).toBe("send-deck");
  });

  it("matches existing rows through the same normalisation", () => {
    const result = mergeTodos(
      [{ id: "1", key: "send-deck", status: "open", notifiedAt: null }],
      [proposed("Send Deck")],
    );

    expect(result.update).toHaveLength(1);
    expect(result.insert).toHaveLength(0);
  });
});
