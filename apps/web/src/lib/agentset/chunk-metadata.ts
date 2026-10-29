const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isNavigatorDocumentId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function resolveChunkDocumentIds(metadata: Record<string, unknown>) {
  const navigatorDocumentId =
    (typeof metadata.navigatorDocumentId === "string"
      ? metadata.navigatorDocumentId
      : undefined) ??
    (isNavigatorDocumentId(metadata.documentId)
      ? metadata.documentId
      : undefined);

  const rawDocumentId =
    typeof metadata.documentId === "string" ? metadata.documentId : undefined;

  const agentsetDocumentId =
    (typeof metadata.agentsetDocumentId === "string"
      ? metadata.agentsetDocumentId
      : undefined) ??
    (rawDocumentId && !isNavigatorDocumentId(rawDocumentId)
      ? rawDocumentId
      : undefined);

  return { navigatorDocumentId, agentsetDocumentId };
}

export function readChunkPageNumber(metadata: Record<string, unknown>) {
  const value = metadata.page_number ?? metadata.pageNumber;
  return typeof value === "number" ? value : undefined;
}

export function readChunkSequenceNumber(metadata: Record<string, unknown>) {
  const value = metadata.sequence_number ?? metadata.sequenceNumber;
  return typeof value === "number" ? value : undefined;
}
