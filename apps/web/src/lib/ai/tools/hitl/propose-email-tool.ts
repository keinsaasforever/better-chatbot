import { tool } from "ai";
import { z } from "zod";

/**
 * HITL Tool: Propose Email
 *
 * This tool presents a draft email for user review and approval.
 * Following the mastra-hitl pattern, this tool has no execute function.
 * The UI component handles result injection via addToolResult().
 *
 * Flow:
 * 1. AI calls this tool with email details
 * 2. Tool has no execute → AI SDK waits for result
 * 3. UI shows email preview with editable body
 * 4. User edits and approves → UI calls addToolResult()
 * 5. Result injected with emailHandle for use by sendEmailTool
 *
 * Formatting: an email is delivered as text/plain or text/html — no mail client
 * parses markdown, so `**bold**` reaches the recipient as literal asterisks.
 * The approval UI resolves the draft on approve and returns both a plain-text
 * body (approvedBody / body / message_body) and an HTML one (approvedBodyHtml /
 * body_html); the sending tool picks whichever its parameters accept.
 *
 * Note: The approval gate is controlled by the UI - addToolResult() is only
 * called when the user clicks "Approve". This ensures human oversight while
 * allowing the user to edit the email body before sending.
 */
export const proposeEmailTool = tool({
  description:
    "Present a draft email for user review and approval. Returns a handle that can be used to send after approval. ALWAYS use this tool before sending emails - never send emails directly.",
  inputSchema: z.object({
    to: z.string().email().describe("Email address of the recipient"),
    subject: z.string().describe("Email subject line"),
    body: z
      .string()
      .describe(
        "Email body as it should read to the recipient. Write prose, not markdown: no **bold**, no #headings, no [links](url) — write the URL out. Use blank lines between paragraphs and '- ' for list items.",
      ),
    mcpServer: z
      .string()
      .optional()
      .describe(
        'MCP server to use for sending (e.g., "gmail", "outlook"). Defaults to user preference.',
      ),
  }),
  // No needsApproval - UI controls the approval flow
  // No execute - UI injects result via addToolResult()
});
