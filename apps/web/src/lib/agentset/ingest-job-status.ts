export type AgentsetDocumentStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

const TERMINAL_AGENTSET_STATUSES = new Set<AgentsetDocumentStatus>([
  "completed",
  "failed",
]);

const PENDING_PIPELINE_STATUSES = new Set([
  "PENDING",
  "BACKLOG",
  "QUEUED",
  "QUEUED_FOR_RESYNC",
  "QUEUED_FOR_DELETE",
]);

const PROCESSING_PIPELINE_STATUSES = new Set([
  "PROCESSING",
  "PRE_PROCESSING",
  "DELETING",
  "CANCELLING",
]);

export function normalizeAgentsetPipelineStatus(
  status: string | null | undefined,
) {
  return status?.trim().toUpperCase() ?? "";
}

export function mapAgentsetPipelineStatus(
  status: string | null | undefined,
): AgentsetDocumentStatus {
  const normalized = normalizeAgentsetPipelineStatus(status);
  if (!normalized) return "processing";
  if (normalized === "COMPLETED" || normalized === "PROCESSED") {
    return "completed";
  }
  if (normalized === "FAILED" || normalized === "CANCELLED") {
    return "failed";
  }
  if (PENDING_PIPELINE_STATUSES.has(normalized)) return "pending";
  if (PROCESSING_PIPELINE_STATUSES.has(normalized)) return "processing";
  return "processing";
}

/** @deprecated Use mapAgentsetPipelineStatus */
export function mapAgentsetIngestJobStatus(
  jobStatus: string,
): AgentsetDocumentStatus {
  return mapAgentsetPipelineStatus(jobStatus);
}

export function deriveAgentsetPipelineStatus(input: {
  jobStatus?: string | null;
  jobCompletedAt?: string | null;
  jobFailedAt?: string | null;
  documentStatus?: string | null;
  documentCompletedAt?: string | null;
  documentFailedAt?: string | null;
}): AgentsetDocumentStatus {
  if (input.documentCompletedAt) return "completed";
  if (input.documentFailedAt) return "failed";
  if (input.documentStatus) {
    const documentStatus = mapAgentsetPipelineStatus(input.documentStatus);
    if (isTerminalAgentsetDocumentStatus(documentStatus)) return documentStatus;
  }

  if (input.jobCompletedAt) return "completed";
  if (input.jobFailedAt) return "failed";
  if (input.jobStatus) {
    const jobStatus = mapAgentsetPipelineStatus(input.jobStatus);
    if (isTerminalAgentsetDocumentStatus(jobStatus)) return jobStatus;
  }

  if (input.documentStatus) {
    return mapAgentsetPipelineStatus(input.documentStatus);
  }
  if (input.jobStatus) {
    return mapAgentsetPipelineStatus(input.jobStatus);
  }

  return "processing";
}

export function isTerminalAgentsetDocumentStatus(
  status: AgentsetDocumentStatus | string,
) {
  return TERMINAL_AGENTSET_STATUSES.has(status as AgentsetDocumentStatus);
}
