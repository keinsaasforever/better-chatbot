import { describe, expect, test } from "vitest";
import { resolveChartAppearance } from "./chart-appearance";

describe("resolveChartAppearance", () => {
  test("defaults to themed palette with everything shown", () => {
    expect(resolveChartAppearance()).toEqual({
      palette: "default",
      background: "theme",
      showValues: true,
      showTooltip: true,
      showDataDetails: true,
      showLegend: true,
    });
  });

  test("null fields fall back to defaults (model omitted them)", () => {
    expect(
      resolveChartAppearance({
        palette: null,
        background: null,
        showValues: null,
        showTooltip: null,
        showDataDetails: null,
        showLegend: null,
      }),
    ).toEqual({
      palette: "default",
      background: "theme",
      showValues: true,
      showTooltip: true,
      showDataDetails: true,
      showLegend: true,
    });
  });

  test("honors an explicit white/blue, no-numbers request", () => {
    expect(
      resolveChartAppearance({
        palette: "blue",
        background: "white",
        showValues: false,
      }),
    ).toMatchObject({
      palette: "blue",
      background: "white",
      showValues: false,
    });
  });

  test("showValues:false is preserved (not treated as missing)", () => {
    expect(resolveChartAppearance({ showValues: false }).showValues).toBe(
      false,
    );
  });
});
