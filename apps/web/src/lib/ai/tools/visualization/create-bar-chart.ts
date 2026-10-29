import { tool as createTool } from "ai";

import { z } from "zod";
import { chartAppearanceShape } from "./chart-appearance";

export const createBarChartTool = createTool({
  description:
    "Create an interactive in-chat bar chart. PREFERRED over matplotlib for standard bar charts. Pass already-aggregated values (e.g. computed in a prior python-execution step from a CSV). Appearance options let you set a blue palette, a white background, and hide numbers.",
  inputSchema: z.object({
    data: z
      .array(
        z.object({
          xAxisLabel: z.string(),
          series: z.array(
            z.object({
              seriesName: z.string(),
              value: z.number(),
            }),
          ),
        }),
      )
      .describe("Chart data with x-axis labels and series values"),
    title: z.string(),
    description: z.string().nullable(),
    yAxisLabel: z.string().nullable().describe("Label for Y-axis"),
    ...chartAppearanceShape,
  }),
  execute: async () => {
    return "Success";
  },
});
