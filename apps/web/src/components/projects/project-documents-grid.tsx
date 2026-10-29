"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import { fetcher } from "@/lib/utils";
import { DocumentCard } from "@/components/projects/document-card";

export type ProjectDocumentForGrid = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: Date | string;
  chunkCount: number;
  embeddingStatus: "pending" | "processing" | "completed" | "failed";
};

type ProjectStatusResponse = {
  projectId: string;
  totalChunks: number;
  embeddedChunks: number;
  pendingChunks: number;
  progress: number;
  documents: ProjectDocumentForGrid[];
};

function needsEmbeddingPoll(docs: ProjectDocumentForGrid[]) {
  return docs.some(
    (d) =>
      d.embeddingStatus === "pending" || d.embeddingStatus === "processing",
  );
}

/**
 * Renders document cards and polls project status while embeddings are still running.
 */
export function ProjectDocumentsGrid({
  projectId,
  initialDocuments,
}: {
  projectId: string;
  initialDocuments: ProjectDocumentForGrid[];
}) {
  const { mutate } = useSWRConfig();
  const statusKey = `/api/projects/${projectId}/status`;

  const { data } = useSWR<ProjectStatusResponse>(statusKey, fetcher, {
    refreshInterval: (latest) =>
      latest?.documents && needsEmbeddingPoll(latest.documents) ? 2500 : 0,
  });

  useEffect(() => {
    void mutate(statusKey);
  }, [initialDocuments, mutate, statusKey]);

  const documents = data?.documents ?? initialDocuments;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {documents.map((doc) => (
        <DocumentCard
          key={doc.id}
          document={{
            id: doc.id,
            filename: doc.filename,
            contentType: doc.contentType,
            size: doc.size,
            createdAt:
              doc.createdAt instanceof Date
                ? doc.createdAt
                : new Date(doc.createdAt),
            chunkCount: doc.chunkCount,
            embeddingStatus: doc.embeddingStatus,
          }}
          projectId={projectId}
        />
      ))}
    </div>
  );
}
