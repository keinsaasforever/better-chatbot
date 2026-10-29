/**
 * Community build: workflow drafting from a transcript is part of the managed
 * workflow generator in the hosted product. Returning null tells the caller to
 * record the idea for the user to build out themselves.
 */
export async function createWorkflowDraftFromTranscript(_input: {
  userId: string;
  orgId: string;
  text: string;
}): Promise<{
  workflowId: string;
  summary?: string | null;
  usage?: { inputTokens?: number; outputTokens?: number };
  modelId?: string;
} | null> {
  return null;
}
