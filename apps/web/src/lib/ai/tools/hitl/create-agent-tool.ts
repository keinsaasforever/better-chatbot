import { tool } from "ai";
import { z } from "zod";

/**
 * HITL Tool: Create Agent
 *
 * Turns what the conversation just built into a reusable agent, optionally with
 * a recurring reminder. Like the other HITL tools it has no `execute`: the SDK
 * emits the call and halts, the review card renders the proposal, and nothing
 * is written until the user presses Create. So there is no server path by which
 * the model can create an agent on its own, and because HITL tools are not
 * bound for unattended runs, a scheduled agent can never create more agents.
 *
 * Files are passed as the artifact URLs of this thread's generated files rather
 * than inline content. The card converts them to storage keys and the API
 * verifies the caller owns each one, so a template costs nothing in the agent's
 * system prompt and is staged into the sandbox on every later run.
 */
export const createAgentTool = tool({
  description: `Save what this conversation built as a reusable agent, and optionally give it a recurring reminder.

Use when the user asks to keep, reuse, schedule or "make an agent" out of the current work. The user reviews and edits everything before anything is created — propose confidently rather than interviewing them first.

Put the reusable instructions in \`systemPrompt\`, never the content of a template or document. Attach those as \`files\` (the URLs of files produced by python-execution in this thread); they are staged into the working directory on every future run and cost no tokens.

Write \`name\`, \`description\` and \`systemPrompt\` in the language the user is speaking.`,
  inputSchema: z.object({
    name: z
      .string()
      .min(1)
      .max(100)
      .describe("Short agent name, in the user's language."),
    description: z
      .string()
      .max(8000)
      .optional()
      .describe("One or two sentences on what the agent does."),
    role: z
      .string()
      .max(200)
      .optional()
      .describe('Area of expertise, e.g. "construction site reporting".'),
    systemPrompt: z
      .string()
      .min(1)
      .describe(
        "The agent's standing instructions: the workflow, the data it needs, the exact code snippet it should run, and any output format. Reference attached files by filename. Do NOT paste template or document content here.",
      ),
    tools: z
      .array(z.string())
      .max(20)
      .optional()
      .describe(
        'Built-in tool names the agent needs, e.g. ["python-execution"]. Unknown names are dropped.',
      ),
    files: z
      .array(
        z.object({
          url: z
            .string()
            .describe(
              "URL of a file generated in this thread, taken verbatim from a tool result.",
            ),
          filename: z
            .string()
            .describe("Name the agent will open the file by in the sandbox."),
        }),
      )
      .max(10)
      .optional()
      .describe(
        "Files from this thread to attach to the agent, e.g. a template and a render script.",
      ),
    schedule: z
      .object({
        cronExpression: z
          .string()
          .min(1)
          .max(100)
          .describe('5-field cron, e.g. "0 8 * * 1" for Mondays at 08:00.'),
        timezone: z
          .string()
          .min(1)
          .max(64)
          .describe('IANA timezone, e.g. "Europe/Berlin".'),
        inputPrompt: z
          .string()
          .max(8000)
          .optional()
          .describe(
            "Message the agent receives on each run. Nobody is present, so this should ask for a short reminder, not for work that needs the user's input.",
          ),
      })
      .optional()
      .describe("Recurring run. Omit unless the user asked for a cadence."),
    model: z
      .string()
      .max(120)
      .optional()
      .describe('Pinned model as "provider/model". Omit to inherit the chat.'),
  }),
  // No execute - the review card writes the agent and injects the result.
});
