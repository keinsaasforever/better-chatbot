"use client";

import type { ParsedCitation } from "@/lib/citations/parse-citations";
import { CitationDocumentLink } from "@/components/citations/citation-document-link";
import { FileText } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "ui/accordion";
import { Badge } from "ui/badge";

interface CitationSourcesPanelProps {
  citations: ParsedCitation[];
  projectId?: string;
}

function CitationPreviewImages({ urls }: { urls: string[] }) {
  if (!urls.length) return null;

  return (
    <div className="flex flex-col gap-2">
      {urls.map((url) => (
        <img
          key={url}
          src={url}
          alt=""
          className="rounded-md border bg-background max-h-48 w-full object-contain"
        />
      ))}
    </div>
  );
}

export function CitationSourcesPanel({
  citations,
  projectId,
}: CitationSourcesPanelProps) {
  if (!citations.length) return null;

  const sorted = [...citations].sort((a, b) => a.index - b.index);

  return (
    <Accordion
      type="single"
      collapsible
      className="w-full border rounded-lg px-3"
    >
      <AccordionItem value="sources" className="border-0">
        <AccordionTrigger className="py-3 hover:no-underline text-sm">
          <span className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            Sources ({sorted.length})
          </span>
        </AccordionTrigger>
        <AccordionContent className="pb-3">
          <ul className="space-y-3">
            {sorted.map((citation, i) => (
              <li
                key={`${citation.index}-${i}`}
                className="rounded-md border bg-muted/20 p-3 space-y-2"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px] h-5">
                    [{citation.index}]
                  </Badge>
                  {citation.documentTitle && (
                    <span className="text-sm font-medium truncate">
                      {citation.documentTitle}
                    </span>
                  )}
                  {citation.pageNumber != null && (
                    <span className="text-xs text-muted-foreground">
                      Page {citation.pageNumber}
                    </span>
                  )}
                  {citation.relevance != null && (
                    <span className="text-xs text-muted-foreground">
                      {Math.round(citation.relevance * 100)}% match
                    </span>
                  )}
                </div>
                <CitationPreviewImages urls={citation.figureUrls ?? []} />
                <p className="text-sm text-muted-foreground italic leading-relaxed">
                  &ldquo;{citation.quote}&rdquo;
                </p>
                {projectId && citation.documentId && (
                  <CitationDocumentLink
                    projectId={projectId}
                    documentId={citation.documentId}
                  />
                )}
              </li>
            ))}
          </ul>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
