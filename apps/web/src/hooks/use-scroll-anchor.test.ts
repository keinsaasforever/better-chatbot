import { describe, expect, it } from "vitest";
import { isScrolledToBottom } from "./use-scroll-anchor";

describe("isScrolledToBottom", () => {
  it("is true when pinned exactly to the bottom", () => {
    expect(
      isScrolledToBottom(
        { scrollHeight: 1000, scrollTop: 800, clientHeight: 200 },
        50,
      ),
    ).toBe(true);
  });

  it("is true within the threshold of the bottom", () => {
    expect(
      isScrolledToBottom(
        { scrollHeight: 1000, scrollTop: 760, clientHeight: 200 },
        50,
      ),
    ).toBe(true);
  });

  it("is false once scrolled past the threshold", () => {
    expect(
      isScrolledToBottom(
        { scrollHeight: 1000, scrollTop: 700, clientHeight: 200 },
        50,
      ),
    ).toBe(false);
  });

  it("honours a custom threshold", () => {
    const metrics = { scrollHeight: 1000, scrollTop: 770, clientHeight: 200 };
    expect(isScrolledToBottom(metrics, 50)).toBe(true);
    expect(isScrolledToBottom(metrics, 20)).toBe(false);
  });
});
