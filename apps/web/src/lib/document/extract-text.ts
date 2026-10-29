export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(buffer), {
    mergePages: true,
  });
  return text;
}

/**
 * mammoth used to be a static import here, so every route that touched this
 * module paid for it on cold start whether or not a .docx ever arrived. The
 * parse itself now lives in `lib/file-ingest/docx.ts`, which chat ingestion
 * shares; this keeps the toolkit's uncapped contract by asking for everything.
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  const { parseDocxPreview } = await import("@/lib/file-ingest/docx");
  const { text } = await parseDocxPreview(buffer, {
    maxChars: Number.MAX_SAFE_INTEGER,
  });
  return text;
}

export async function extractText(
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf")) {
    return extractTextFromPdf(buffer);
  }
  if (
    ct.includes("wordprocessingml") ||
    ct.includes("docx") ||
    ct.includes("word")
  ) {
    return extractTextFromDocx(buffer);
  }
  if (ct.includes("text")) {
    return buffer.toString("utf-8");
  }
  return buffer.toString("utf-8");
}
