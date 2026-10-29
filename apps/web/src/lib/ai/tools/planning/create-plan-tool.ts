import { tool as createTool } from "ai";
import { z } from "zod";

export const planStepSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
});

export const createPlanInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  steps: z.array(planStepSchema).min(1),
});

export type CreatePlanInput = z.infer<typeof createPlanInputSchema>;

// Chart-tool convention: the artifact IS the tool input. The client renders
// the plan from `part.input`; execute only settles the call.
export const createPlanTool = createTool({
  description:
    "Present a step-by-step plan as a plan artifact the user can open in " +
    "the side panel. Use this when the user wants to see an approach, " +
    "roadmap, or breakdown of work BEFORE anything is done: after " +
    "researching, lay out the ordered steps with a short description each. " +
    "Do NOT use this to request approval for actions you are about to " +
    "execute yourself - use askForPlanApproval for that. This tool only " +
    "creates the plan document; it never executes any step.",
  inputSchema: createPlanInputSchema,
  execute: async () => {
    return "Success";
  },
});
