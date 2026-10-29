import { z } from "zod";

/**
 * Optional appearance controls shared by the bar/line/pie chart tools. All
 * fields are nullable+optional so the model may omit them; the chart components
 * apply "everything shown, themed palette" defaults when a field is null.
 *
 * Spread this shape into each chart tool's `inputSchema` and pass the same
 * fields through to the rendering component.
 */
export const chartAppearanceShape = {
  palette: z
    .enum(["default", "blue"])
    .nullable()
    .optional()
    .describe(
      'Color palette. "blue" renders a white→blue monochrome ramp (good for a "white and blue" look); omit or "default" for the themed multi-color palette.',
    ),
  background: z
    .enum(["theme", "white"])
    .nullable()
    .optional()
    .describe(
      'Chart background. "white" forces a white background regardless of theme; omit or "theme" to follow the app theme.',
    ),
  showValues: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Whether to show numbers. false hides numeric axis ticks, tooltip amounts, and pie value/percent labels while KEEPING category/date labels. Default true.",
    ),
  showTooltip: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether to show the hover tooltip. Default true."),
  showDataDetails: z
    .boolean()
    .nullable()
    .optional()
    .describe(
      "Whether to show the raw-data (JSON) button on the chart card. Default true.",
    ),
  showLegend: z
    .boolean()
    .nullable()
    .optional()
    .describe("Whether to show the series legend. Default true."),
} as const;

export type ChartAppearance = {
  palette?: "default" | "blue" | null;
  background?: "theme" | "white" | null;
  showValues?: boolean | null;
  showTooltip?: boolean | null;
  showDataDetails?: boolean | null;
  showLegend?: boolean | null;
};

/** Resolve the nullable appearance inputs to concrete rendering flags. */
export function resolveChartAppearance(a: ChartAppearance = {}) {
  return {
    palette: a.palette ?? "default",
    background: a.background ?? "theme",
    showValues: a.showValues ?? true,
    showTooltip: a.showTooltip ?? true,
    showDataDetails: a.showDataDetails ?? true,
    showLegend: a.showLegend ?? true,
  };
}
