import { tool } from "ai";
import { z } from "zod";

/**
 * HITL Tool: Ask for Plan Approval
 *
 * This meta-tool requests user approval before executing multi-step workflows.
 * Following the AI SDK 6 client-side pattern (like proposeEmail):
 * - NO needsApproval (UI controls approval)
 * - NO execute function (UI injects result via addToolResult)
 *
 * Flow:
 * 1. AI analyzes user request (e.g., "Research X and email me")
 * 2. AI recognizes this is multi-step
 * 3. AI calls this tool with a plan
 * 4. Tool has no execute → AI SDK waits for result
 * 5. UI shows editable todo list (state='input-available')
 * 6. User edits/deletes todos, then approves, rejects, or comments
 * 7. UI calls addToolResult with the edited todos (and any comment)
 * 8. AI executes the approved plan, or revises it from the comment
 */
export const askForPlanApprovalTool = tool({
  description:
    "Request user approval before executing planned multi-step actions. Use this when a task requires multiple steps or tools. Present a clear plan with actionable steps. " +
    "The result is one of three outcomes: approved:true (execute the returned todos), rejected:true (stop and ask what to do instead), or changesRequested:true / answeredInChat:true with the user's own words in `feedback`/`userMessage` — in that case do not execute the plan; follow what they wrote, which may replace the plan entirely, and present the revised plan for approval.",
  inputSchema: z.object({
    todos: z
      .array(
        z.object({
          text: z.string().describe("Clear description of the action step"),
          status: z
            .enum(["pending", "in_progress", "completed"])
            .describe("Current status of this step"),
        }),
      )
      .describe("List of planned steps to execute"),
    explainer: z
      .string()
      .describe(
        "Brief explanation of what this plan will accomplish and why these steps are needed",
      ),
  }),
  // NO needsApproval - UI controls the approval flow
  // NO execute - UI injects edited todos via addToolResult()
});
