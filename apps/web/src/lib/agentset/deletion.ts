import "server-only";
import { NotFoundError } from "agentset";
import { getAgentsetClient, getAgentsetNamespace } from "./client";
import { formatAgentsetError } from "./projects";
import { isAgentsetCreatedAtSchemaError } from "./ingest-job-fetch";

function isAgentsetNotFound(error: unknown) {
  if (error instanceof NotFoundError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: number }).status === 404
  );
}

/**
 * Errors Agentset returns when the resource is already gone or the API can't
 * serialize the response payload. Both are safe to swallow during a delete:
 * the goal is to free the upstream resource, and either way we've achieved it
 * (or the API isn't usable to confirm and we shouldn't block the local delete).
 */
function isRecoverableDeleteError(error: unknown) {
  return isAgentsetNotFound(error) || isAgentsetCreatedAtSchemaError(error);
}

/**
 * Delete a document from Agentset. Resilient to 404 (already gone) and the
 * known 422 createdAt schema drift. Other errors are rethrown so callers can
 * decide whether to surface them.
 */
export async function deleteAgentsetDocument(input: {
  namespaceId: string;
  agentsetDocumentId: string;
}): Promise<{ deleted: boolean; reason?: string }> {
  const namespace = getAgentsetNamespace(input.namespaceId);

  try {
    await namespace.documents.delete(input.agentsetDocumentId);
    return { deleted: true };
  } catch (error) {
    if (isRecoverableDeleteError(error)) {
      console.warn("[agentset] document delete treated as already-gone", {
        namespaceId: input.namespaceId,
        agentsetDocumentId: input.agentsetDocumentId,
        error: formatAgentsetError(error),
      });
      return { deleted: false, reason: formatAgentsetError(error) };
    }
    throw error;
  }
}

/**
 * Delete an entire Agentset namespace. Cleans up every document in the
 * namespace in one call — preferred path when removing a project. Resilient to
 * 404 and the createdAt schema drift.
 */
export async function deleteAgentsetNamespace(input: {
  namespaceId: string;
}): Promise<{ deleted: boolean; reason?: string }> {
  const agentset = getAgentsetClient();

  try {
    await agentset.namespaces.delete(input.namespaceId);
    return { deleted: true };
  } catch (error) {
    if (isRecoverableDeleteError(error)) {
      console.warn("[agentset] namespace delete treated as already-gone", {
        namespaceId: input.namespaceId,
        error: formatAgentsetError(error),
      });
      return { deleted: false, reason: formatAgentsetError(error) };
    }
    throw error;
  }
}
