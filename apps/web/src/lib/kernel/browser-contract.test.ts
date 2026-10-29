import { describe, expect, it } from "vitest";
import {
  DEFAULT_KERNEL_BROWSER_TYPE,
  DEFAULT_KERNEL_PROXY_MODE,
  KERNEL_BROWSER_MULTIPLIERS,
  KERNEL_USD_PER_SECOND,
  BROWSER_MAX_STEPS,
  isBrowserSessionOver,
  toReadOnlyLiveViewUrl,
  UNATTENDED_MAX_RUN_MS,
  toBillableUnits,
} from "./browser-contract";

describe("kernel browser billing units", () => {
  it("bills a headless second as one unit", () => {
    expect(toBillableUnits(1, "headless")).toBe(1);
  });

  it("applies Kernel's 8x headful and 48x GPU multipliers", () => {
    expect(toBillableUnits(1, "headful")).toBe(8);
    expect(toBillableUnits(1, "gpu")).toBe(48);
    expect(toBillableUnits(30, "headful")).toBe(240);
  });

  it("rounds partial seconds up so a short run is never free", () => {
    expect(toBillableUnits(0.2, "headless")).toBe(1);
    expect(toBillableUnits(1.1, "headful")).toBe(16);
  });

  it("returns zero for non-positive or non-finite durations", () => {
    expect(toBillableUnits(0, "headful")).toBe(0);
    expect(toBillableUnits(-5, "headful")).toBe(0);
    expect(toBillableUnits(Number.NaN, "headful")).toBe(0);
    expect(toBillableUnits(Number.POSITIVE_INFINITY, "headful")).toBe(0);
  });

  /**
   * The multipliers are what let a single Autumn credit cost price all three
   * browser types. If Kernel's rate card ever stops being exact multiples of
   * the headless rate, the normalisation is wrong and the feature needs
   * per-type pricing instead — so assert the relationship, not just the
   * constants.
   */
  it("matches the ratios in Kernel's published rate card", () => {
    const headless = KERNEL_USD_PER_SECOND.headless;
    for (const type of ["headless", "headful", "gpu"] as const) {
      const ratio = KERNEL_USD_PER_SECOND[type] / headless;
      expect(ratio).toBeCloseTo(KERNEL_BROWSER_MULTIPLIERS[type], 2);
    }
  });

  it("defaults to headful, so the user can watch the run", () => {
    expect(DEFAULT_KERNEL_BROWSER_TYPE).toBe("headful");
  });

  it("counts every terminal state as over, including blocked", () => {
    expect(isBrowserSessionOver("done")).toBe(true);
    expect(isBrowserSessionOver("failed")).toBe(true);
    // The browser IS torn down on a block: nobody is coming to finish it, and
    // holding a headful browser open on the chance someone might is how a
    // concurrency slot leaks.
    expect(isBrowserSessionOver("blocked")).toBe(true);
    expect(isBrowserSessionOver("starting")).toBe(false);
    expect(isBrowserSessionOver("running")).toBe(false);
    expect(isBrowserSessionOver(undefined)).toBe(false);
  });

  /**
   * Legacy. The human-in-the-loop park no longer exists, but runs from before
   * it was removed are persisted in `chat_message.parts`, and the panel still
   * renders them — as a live handoff, which is what they were.
   */
  it("still reads a legacy parked run as live", () => {
    expect(isBrowserSessionOver("awaiting-user")).toBe(false);
  });

  it("keeps the unattended budgets tighter than the interactive ones", () => {
    expect(BROWSER_MAX_STEPS.unattended).toBeLessThan(
      BROWSER_MAX_STEPS.interactive,
    );
    // A cost guard, not a preference: nothing else stops a stuck unattended
    // agent from billing headful seconds, because the tool's own REST calls
    // keep resetting Kernel's inactivity timer.
    expect(UNATTENDED_MAX_RUN_MS).toBeGreaterThan(0);
  });
});

/**
 * The egress default is a correctness fix, not a preference: Kernel's managed
 * proxy pool blocks government, banking and payment domains at the network
 * layer, and those portals are what the browser tool exists to reach. A change
 * back to `default` would break e-MTA and every bank with no visible error, so
 * it is asserted rather than left to a code review to catch.
 */
describe("kernel egress mode", () => {
  it("egresses directly, so government and banking domains stay reachable", () => {
    expect(DEFAULT_KERNEL_PROXY_MODE).toBe("direct");
  });
});

describe("read-only live view", () => {
  it("adds the flag that turns an interactive live view into a viewer", () => {
    expect(
      toReadOnlyLiveViewUrl("https://api.onkernel.com/browser/live/T"),
    ).toBe("https://api.onkernel.com/browser/live/T?readOnly=true");
  });

  it("keeps the token and any other query parameters intact", () => {
    const result = new URL(
      toReadOnlyLiveViewUrl("https://api.onkernel.com/live?token=abc&zoom=2"),
    );
    expect(result.searchParams.get("token")).toBe("abc");
    expect(result.searchParams.get("zoom")).toBe("2");
    expect(result.searchParams.get("readOnly")).toBe("true");
  });

  it("does not duplicate the flag when it is already set", () => {
    const once = toReadOnlyLiveViewUrl("https://api.onkernel.com/live?x=1");
    expect(toReadOnlyLiveViewUrl(once)).toBe(once);
  });

  /**
   * An unparseable URL is already handled downstream as "no live view". Failing
   * a whole browser run over it would be the worse outcome.
   */
  it("returns a malformed URL unchanged rather than throwing", () => {
    expect(toReadOnlyLiveViewUrl("not-a-url")).toBe("not-a-url");
    expect(toReadOnlyLiveViewUrl("")).toBe("");
  });
});
