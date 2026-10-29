"use client";

import { toast } from "sonner";
import { buildDocumentDownloadUrl } from "./parse-citations";

export async function openProjectDocument(
  projectId: string,
  documentId: string,
): Promise<boolean> {
  try {
    const response = await fetch(
      buildDocumentDownloadUrl(projectId, documentId),
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(body?.error ?? "Failed to get download URL");
    }

    const { url, filename } = (await response.json()) as {
      url: string;
      filename?: string;
    };

    const link = globalThis.document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    if (filename) link.download = filename;
    globalThis.document.body.appendChild(link);
    link.click();
    globalThis.document.body.removeChild(link);
    return true;
  } catch (error) {
    console.error("Document open error:", error);
    toast.error(
      error instanceof Error ? error.message : "Failed to open document",
    );
    return false;
  }
}
