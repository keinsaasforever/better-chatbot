"use client";

import { openProjectDocument } from "@/lib/citations/open-project-document";
import { LinkIcon } from "lucide-react";

interface CitationDocumentLinkProps {
  projectId: string;
  documentId: string;
  label?: string;
}

export function CitationDocumentLink({
  projectId,
  documentId,
  label = "View document",
}: CitationDocumentLinkProps) {
  return (
    <button
      type="button"
      onClick={() => openProjectDocument(projectId, documentId)}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      <LinkIcon className="size-3" />
      {label}
    </button>
  );
}
