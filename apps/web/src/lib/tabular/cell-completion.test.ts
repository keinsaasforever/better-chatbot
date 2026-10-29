import { describe, expect, it } from "vitest";
import {
  cellKey,
  collectAnsweredCells,
  hasUnansweredCells,
  isAnsweredCell,
  type StoredCell,
} from "./cell-completion";

const cell = (over: Partial<StoredCell> = {}): StoredCell => ({
  documentId: "doc-1",
  columnId: "col-1",
  value: "42",
  status: "done",
  ...over,
});

describe("isAnsweredCell", () => {
  it("accepts a done cell with text", () => {
    expect(isAnsweredCell(cell())).toBe(true);
  });

  it("rejects a done cell whose value is blank", () => {
    expect(isAnsweredCell(cell({ value: "   " }))).toBe(false);
    expect(isAnsweredCell(cell({ value: null }))).toBe(false);
  });

  it("rejects every non-done status, so those get another attempt", () => {
    for (const status of ["pending", "generating", "error", undefined]) {
      expect(isAnsweredCell(cell({ status }))).toBe(false);
    }
  });
});

describe("collectAnsweredCells", () => {
  it("keys answers by document and column", () => {
    const answered = collectAnsweredCells([
      cell({ documentId: "a", columnId: "x", value: "one" }),
      cell({ documentId: "b", columnId: "x", value: "two" }),
    ]);

    expect(answered.get(cellKey("a", "x"))).toBe("one");
    expect(answered.get(cellKey("b", "x"))).toBe("two");
  });

  it("leaves out anything unanswered", () => {
    const answered = collectAnsweredCells([
      cell({ columnId: "done" }),
      cell({ columnId: "failed", status: "error", value: "Error: boom" }),
      cell({ columnId: "empty", status: "pending", value: null }),
    ]);

    expect([...answered.keys()]).toEqual([cellKey("doc-1", "done")]);
  });
});

describe("hasUnansweredCells", () => {
  it("is false once every cell holds an answer - the remount case", () => {
    expect(
      hasUnansweredCells([cell({ columnId: "a" }), cell({ columnId: "b" })]),
    ).toBe(false);
  });

  it("is true when one cell is still pending", () => {
    expect(
      hasUnansweredCells([
        cell({ columnId: "a" }),
        cell({ columnId: "b", status: "pending", value: null }),
      ]),
    ).toBe(true);
  });

  it("is true when a previous run left an error behind", () => {
    expect(
      hasUnansweredCells([cell({ status: "error", value: "Error: boom" })]),
    ).toBe(true);
  });

  it("is true for an empty list rather than reporting completion", () => {
    expect(hasUnansweredCells([])).toBe(true);
  });
});
