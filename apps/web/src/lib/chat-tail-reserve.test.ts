import { describe, expect, it } from "vitest";
import { tailReservePx } from "./chat-tail-reserve";

describe("tailReservePx", () => {
  it("reserves the room left below the message", () => {
    // 700px viewport - 48px header = 652 visible; 84px message, 160px composer
    // overlay, 24px padding -> 384px of filler.
    expect(
      tailReservePx({
        clientHeight: 652,
        contentBelowMessageTop: 84,
        composerOverlay: 160,
        scrollPaddingTop: 24,
      }),
    ).toBe(384);
  });

  it("shrinks with the viewport instead of staying at a fixed 55dvh", () => {
    const tall = tailReservePx({
      clientHeight: 800,
      contentBelowMessageTop: 84,
      composerOverlay: 160,
      scrollPaddingTop: 24,
    });
    const short = tailReservePx({
      clientHeight: 500,
      contentBelowMessageTop: 84,
      composerOverlay: 160,
      scrollPaddingTop: 24,
    });
    expect(tall).toBeGreaterThan(short);
    expect(tall - short).toBe(300);
  });

  it("still clears the floating composer when the answer overflows the viewport", () => {
    // A long answer leaves no room to pin anything, but the tail must still be
    // able to scroll clear of the composer — otherwise the last lines of the
    // answer sit behind the input.
    expect(
      tailReservePx({
        clientHeight: 500,
        contentBelowMessageTop: 700,
        composerOverlay: 160,
        scrollPaddingTop: 24,
      }),
    ).toBe(160);
  });

  it("never returns less than the composer overlay", () => {
    expect(
      tailReservePx({
        clientHeight: 0,
        contentBelowMessageTop: 0,
        composerOverlay: 0,
        scrollPaddingTop: 0,
      }),
    ).toBe(0);
    expect(
      tailReservePx({
        clientHeight: Number.NaN,
        contentBelowMessageTop: 84,
        composerOverlay: 160,
        scrollPaddingTop: 24,
      }),
    ).toBe(160);
  });
});
