import { tool as createTool } from "ai";
import { z } from "zod";
import { chartAppearanceShape } from "./chart-appearance";

export const createPieChartTool = createTool({
  description:
    "Create an interactive in-chat pie chart. PREFERRED over matplotlib for standard pie charts. Pass already-aggregated values (e.g. computed in a prior python-execution step from a CSV). Appearance options let you set a blue palette, a white background, and hide numbers.",
  inputSchema: z.object({
    data: z.array(z.object({ label: z.string(), value: z.number() })),
    title: z.string(),
    description: z.string().nullable(),
    unit: z.string().nullable(),
    ...chartAppearanceShape,
  }),
  execute: async () => {
    return "Success";
  },
});
