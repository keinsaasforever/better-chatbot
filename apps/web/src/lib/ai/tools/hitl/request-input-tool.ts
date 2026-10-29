import { tool } from "ai";
import { z } from "zod";

/** Matches the card's layout budget; more than this belongs in a conversation. */
export const MAX_REQUEST_INPUT_QUESTIONS = 4;
/** Two is the fewest that is a choice; beyond four the card stops scanning. */
export const MIN_REQUEST_INPUT_OPTIONS = 2;
export const MAX_REQUEST_INPUT_OPTIONS = 4;

/**
 * HITL Tool: Request Input
 *
 * Blocks execution to collect answers only the user can give. Client-side
 * pattern: no `execute`, no `needsApproval` — the card answers the parked call
 * through `addToolResult`.
 *
 * Takes a LIST of questions rather than one. The model used to fire several
 * `requestInput` calls in a single step to gather related details (observed on
 * staging: three calls in one step, none answered), which parks the turn behind
 * three separate cards. One call carrying every question is one card, one
 * submit, one result.
 *
 * Each question may offer options. The card always adds a free-text field
 * alongside them, so an offered choice never becomes a forced one.
 */
export const requestInputTool = tool({
  description: `Ask the user for information only they can provide, and wait for their answer.

Put EVERY question you need answered into a single call — up to 4. Never emit several requestInput calls in one turn: each one parks the conversation behind its own card.

Offer \`options\` whenever the sensible answers are enumerable (a cadence, a channel, a format, a yes/no). The user can always type something else instead, so options are a shortcut, not a restriction. Leave \`options\` off for genuinely open answers like a name, an API key or a URL.`,
  inputSchema: z.object({
    questions: z
      .array(
        z.object({
          header: z
            .string()
            .min(1)
            .max(20)
            .describe(
              'Two or three words naming the question, shown as a chip (e.g. "Cadence", "Sources").',
            ),
          question: z
            .string()
            .min(1)
            .describe("The question, written in the user's language."),
          options: z
            .array(
              z.object({
                label: z
                  .string()
                  .min(1)
                  .describe("The choice itself, a few words."),
                description: z
                  .string()
                  .optional()
                  .describe(
                    "One short line on what picking this means. Optional.",
                  ),
              }),
            )
            .min(MIN_REQUEST_INPUT_OPTIONS)
            .max(MAX_REQUEST_INPUT_OPTIONS)
            .optional()
            .describe(
              "Suggested answers. Omit entirely when the answer is open-ended.",
            ),
          multiSelect: z
            .boolean()
            .optional()
            .default(false)
            .describe("Allow picking more than one option."),
          placeholder: z
            .string()
            .optional()
            .describe("Hint text for the free-text field."),
          inputType: z
            .enum(["text", "password", "number", "email", "url"])
            .optional()
            .default("text")
            .describe(
              "Type of the free-text field. Use password for secrets so the value is masked.",
            ),
        }),
      )
      .min(1)
      .max(MAX_REQUEST_INPUT_QUESTIONS)
      .describe("Every question you need answered, asked together."),
  }),
  // NO needsApproval - the card controls submission
  // NO execute - the card injects the answers via addToolResult()
});
