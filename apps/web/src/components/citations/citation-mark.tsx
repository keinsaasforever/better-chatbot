"use client";

import { useMemo, useState } from "react";
import {
  getCitationsForIndex,
  type ParsedCitation,
} from "@/lib/citations/parse-citations";
import { CitationDocumentLink } from "@/components/citations/citation-document-link";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "ui/hover-card";

interface CitationMarkProps {
  index: number;
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
          className="rounded-md border bg-background max-h-40 w-full object-contain"
        />
      ))}
    </div>
  );
}

export function CitationMark({
  index,
  citations,
  projectId,
}: CitationMarkProps) {
  const matches = useMemo(
    () => getCitationsForIndex(citations, index),
    [citations, index],
  );
  const [activeSlide, setActiveSlide] = useState(0);
  const current = matches[activeSlide] ?? matches[0];

  if (!current) {
    return (
      <sup className="text-[10px] text-muted-foreground align-super mx-0.5">
        [{index}]
      </sup>
    );
  }

  const label = current.documentTitle ?? `Source ${index}`;

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex align-baseline mx-0.5 -translate-y-0.5",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
          )}
          aria-label={`Citation ${index}: ${label}`}
        >
          <Badge
            variant="secondary"
            className="h-4 min-w-4 px-1 text-[10px] font-medium cursor-pointer hover:bg-primary/15"
          >
            {index}
          </Badge>
        </button>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 md:w-96 p-0 overflow-hidden">
        {matches.length > 1 && (
          <div className="flex items-center justify-between border-b px-3 py-2 bg-muted/30">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={activeSlide === 0}
              onClick={() => setActiveSlide((s) => Math.max(0, s - 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground">
              {activeSlide + 1} / {matches.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={activeSlide >= matches.length - 1}
              onClick={() =>
                setActiveSlide((s) => Math.min(matches.length - 1, s + 1))
              }
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
        <div className="p-3 space-y-2">
          <div className="flex items-start gap-2">
            <FileText className="size-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-snug truncate">
                {current.documentTitle ?? `Source ${index}`}
              </p>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                {current.pageNumber != null && (
                  <p className="text-xs text-muted-foreground">
                    Page {current.pageNumber}
                  </p>
                )}
                {current.relevance != null && (
                  <p className="text-xs text-muted-foreground">
                    {Math.round(current.relevance * 100)}% relevance
                  </p>
                )}
              </div>
            </div>
          </div>
          <CitationPreviewImages urls={current.figureUrls ?? []} />
          <blockquote className="border-l-2 border-primary/30 pl-3 text-sm text-muted-foreground italic leading-relaxed">
            &ldquo;{current.quote}&rdquo;
          </blockquote>
          {projectId && current.documentId && (
            <CitationDocumentLink
              projectId={projectId}
              documentId={current.documentId}
            />
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
