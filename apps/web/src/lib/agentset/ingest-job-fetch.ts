import { UnprocessableEntityError } from "agentset";

export type AgentsetIngestJobSnapshot = {
  status?: string | null;
  error?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
};

/**
 * Agentset's API returns 422 from GET endpoints whose response schema drifted
 * (e.g. `createdAt: expected date, received string`). This is server-side Zod
 * validation on their response shape, not a real client error. Treat it as a
 * recoverable "details unavailable" so our flows can fall back instead of
 * failing the whole upload/poll.
 */
export function isAgentsetCreatedAtSchemaError(error: unknown) {
  if (error instanceof UnprocessableEntityError) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  return /invalid_type:\s*createdAt/i.test(message);
}

/** @deprecated Use {@link isAgentsetCreatedAtSchemaError}. */
export const isIngestJobFetchUnavailableError = isAgentsetCreatedAtSchemaError;

export async function fetchIngestJobSnapshot(
  ingestion: { get: (jobId: string) => Promise<unknown> },
  jobId: string,
): Promise<AgentsetIngestJobSnapshot | null> {
  try {
    return (await ingestion.get(jobId)) as AgentsetIngestJobSnapshot;
  } catch (error) {
    if (!isAgentsetCreatedAtSchemaError(error)) {
      throw error;
    }

    console.warn("[agentset] ingest job fetch unavailable, using fallback", {
      jobId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
