import { describe, expect, it } from "vitest";
import { formatModelPrice } from "./select-model";

describe("formatModelPrice", () => {
  it("drops the trailing zeros drizzle's numeric columns carry", () => {
    // The raw column value is "3.0000000000".
    expect(formatModelPrice("3.0000000000", "15.0000000000")).toBe("$3 / $15");
  });

  it("keeps enough precision to tell cheap models apart", () => {
    // $0.15 and $0.075 must not both collapse to "$0.1".
    expect(formatModelPrice("0.1500000000", "0.6000000000")).toBe(
      "$0.15 / $0.6",
    );
    expect(formatModelPrice("0.0750000000", "0.3000000000")).toBe(
      "$0.075 / $0.3",
    );
    expect(formatModelPrice("0.0010000000", "0.0020000000")).toBe(
      "$0.001 / $0.002",
    );
  });

  it("keeps significant decimals above a dollar", () => {
    expect(formatModelPrice("1.2500000000", "10.0000000000")).toBe(
      "$1.25 / $10",
    );
  });

  it("renders a free model as $0 rather than nothing", () => {
    expect(formatModelPrice("0", "0")).toBe("$0 / $0");
  });

  it("returns null unless both sides are known", () => {
    // Half a price is more misleading than no price.
    expect(formatModelPrice(null, "5")).toBeNull();
    expect(formatModelPrice("5", null)).toBeNull();
    expect(formatModelPrice(undefined, undefined)).toBeNull();
  });

  it("returns null for values that are not numbers", () => {
    expect(formatModelPrice("abc", "5")).toBeNull();
    expect(formatModelPrice("-1", "5")).toBeNull();
  });
});
