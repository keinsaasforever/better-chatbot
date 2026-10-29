/**
 * HITL (Human-in-the-Loop) UI Components
 *
 * These components render approval UIs for tools with needsApproval: true.
 * Adapted from mastra-hitl for AI SDK 6.
 */

export {
  type CreateAgentOutcome,
  type CreateAgentProposal,
  CreateAgentReviewUI,
} from "./create-agent-review";
export { EmailPreviewUI } from "./email-preview";
export { HITL_TOOL_LABEL_KEYS } from "./hitl-tool-labels";
export { PlanApprovalUI } from "./plan-approval";
export { type RequestInputAnswer, RequestInputUI } from "./request-input";
