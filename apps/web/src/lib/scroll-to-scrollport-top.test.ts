import { describe, expect, it } from "vitest";
import { scrollTopForTopAlignment } from "./scroll-to-scrollport-top";

describe("scrollTopForTopAlignment", () => {
  it("aligns the element top with the scrollport top, minus the offset", () => {
    // Element is 300px below the scrollport top while scrolled to 100.
    const top = scrollTopForTopAlignment(
      {
        scrollTop: 100,
        scrollHeight: 3000,
        clientHeight: 600,
        scrollportTop: 56,
        elementTop: 356,
      },
      8,
    );
    expect(top).toBe(392);
  });

  it("never scrolls past the bottom of the scrollport", () => {
    // Mobile case: dvh-sized trailing spacers are shorter than the space the
    // element would need, so the naive target exceeds the scroll range.
    const top = scrollTopForTopAlignment(
      {
        scrollTop: 200,
        scrollHeight: 1000,
        clientHeight: 400,
        scrollportTop: 56,
        elementTop: 856,
      },
      8,
    );
    expect(top).toBe(600);
  });

  it("never scrolls above the top of the scrollport", () => {
    const top = scrollTopForTopAlignment(
      {
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 400,
        scrollportTop: 56,
        elementTop: 20,
      },
      8,
    );
    expect(top).toBe(0);
  });
});
