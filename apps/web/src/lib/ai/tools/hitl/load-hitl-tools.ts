import { Tool } from "ai";
import { proposeEmailTool } from "./propose-email-tool";
import { askForPlanApprovalTool } from "./ask-for-plan-approval-tool";
import { requestInputTool } from "./request-input-tool";
import { createAgentTool } from "./create-agent-tool";

/**
 * Load all HITL (Human-in-the-Loop) tools
 *
 * These tools are ALWAYS available (not mention-based) and should:
 * 1. NOT appear in the tool selector UI
 * 2. Be triggered by system prompt instructions
 * 3. Work alongside MCP, Workflow, and App Default tools
 *
 * Key HITL Tools:
 * - proposeEmail: Preview email with inline editing before sending.
 *   After user approves, the AI sends via its connected email tool
 *   (Composio MULTI_EXECUTE_TOOL / GMAIL_SEND_EMAIL etc.) using the
 *   approvedBody / recipient_email fields from the proposeEmail result.
 * - askForPlanApproval: Get user approval for multi-step workflows
 * - requestInput: Block execution to collect user input
 * - createAgent: Save the conversation's work as a reusable agent, with an
 *   optional schedule. The card performs the writes after approval.
 *
 * @returns Record of HITL tools ready for Vercel AI SDK
 */
export function loadHitlTools(_userId: string): Record<string, Tool> {
  return {
    proposeEmail: proposeEmailTool,
    askForPlanApproval: askForPlanApprovalTool,
    requestInput: requestInputTool,
    createAgent: createAgentTool,
  };
}

/**
 * Get list of HITL tool names (for filtering from UI mentions)
 */
export function getHitlToolNames(): string[] {
  return ["proposeEmail", "askForPlanApproval", "requestInput", "createAgent"];
}

/**
 * Check if a tool name is a HITL tool (should be hidden from UI)
 */
export function isHitlTool(toolName: string): boolean {
  return getHitlToolNames().includes(toolName);
}
