/** Serializable retrieval hit stored on assistant message metadata. */
export type RetrievalSource = {
  rank: number;
  source: string;
  content: string;
  similarity: number;
  /** Navigator DocumentTable.id (UUID) */
  documentId?: string | null;
  agentsetDocumentId?: string | null;
  chunkId?: string | null;
  pageNumber?: number;
  sequenceNumber?: number;
  figureUrls?: string[];
};
