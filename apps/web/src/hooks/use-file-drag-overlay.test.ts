import { describe, expect, it } from "vitest";
import { isFileDragEvent } from "./use-file-drag-overlay";

const createDragEvent = (dataTransfer: Partial<DataTransfer> | null) =>
  ({
    dataTransfer: dataTransfer ?? null,
  }) as unknown as DragEvent;

describe("use-file-drag-overlay helpers", () => {
  it("returns false when dataTransfer is missing", () => {
    expect(isFileDragEvent(createDragEvent(null))).toBe(false);
  });

  it("detects file drag via items", () => {
    const event = createDragEvent({
      items: [
        { kind: "string" },
        { kind: "file" },
      ] as unknown as DataTransferItemList,
    });

    expect(isFileDragEvent(event)).toBe(true);
  });

  it("returns false when no items are files", () => {
    const event = createDragEvent({
      items: [{ kind: "string" }] as unknown as DataTransferItemList,
    });

    expect(isFileDragEvent(event)).toBe(false);
  });

  it("uses types fallback when items are unavailable", () => {
    const event = createDragEvent({
      types: ["Files", "text/plain"],
    });

    expect(isFileDragEvent(event)).toBe(true);
  });

  it("returns false for non-file types", () => {
    const event = createDragEvent({
      types: ["text/plain"],
    });

    expect(isFileDragEvent(event)).toBe(false);
  });
});
