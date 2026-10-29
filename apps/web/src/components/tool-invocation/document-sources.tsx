"use client";

import { ToolUIPart, getToolName } from "ai";
import { DefaultToolName } from "lib/ai/tools";
import type { ParsedCitation } from "@/lib/citations/parse-citations";
import equal from "lib/equal";
import { BookOpen, FileSearch } from "lucide-react";
import { memo } from "react";
import { CitedMarkdown } from "@/components/citations/cited-markdown";
import { CitationSourcesPanel } from "@/components/citations/citation-sources-panel";
import { Badge } from "ui/badge";
import { TextShimmer } from "ui/text-shimmer";

interface DocumentSourcesToolProps {
  part: ToolUIPart;
  projectId?: string;
}

type AnalyzeDocumentOutput = {
  answer?: string;
  citations?: ParsedCitation[];
  documentId?: string;
  filename?: string;
  error?: string;
};

type KnowledgeBaseResult = {
  rank: number;
  content: string;
  source: string;
  relevance?: string;
  similarity?: number;
  documentId?: string;
  chunkId?: string;
  metadata?: Record<string, unknown>;
};

type KnowledgeBaseOutput = {
  success?: boolean;
  message?: string;
  results?: KnowledgeBaseResult[];
  error?: string;
};

function AnalyzeDocumentToolInvocation({
  part,
  projectId,
}: DocumentSourcesToolProps) {
  const output = part.output as AnalyzeDocumentOutput | undefined;

  if (!part.state.startsWith("output")) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <FileSearch className="size-5 text-muted-foreground animate-pulse" />
        <TextShimmer>Analyzing document…</TextShimmer>
      </div>
    );
  }

  if (output?.error) {
    return <p className="text-sm text-destructive px-2">{output.error}</p>;
  }

  const citations = (output?.citations ?? []).map((c) => ({
    ...c,
    documentId: c.documentId ?? output?.documentId,
    documentTitle: c.documentTitle ?? output?.filename,
  }));

  if (!output?.answer) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileSearch className="size-4" />
        <span>{output.filename ?? "Document analysis"}</span>
      </div>
      <CitedMarkdown
        text={output.answer}
        citations={citations}
        projectId={projectId}
      />
    </div>
  );
}

function SearchKnowledgeBaseToolInvocation({
  part,
  projectId,
}: DocumentSourcesToolProps) {
  const output = part.output as KnowledgeBaseOutput | undefined;

  if (!part.state.startsWith("output")) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <BookOpen className="size-5 text-muted-foreground animate-pulse" />
        <TextShimmer>Searching knowledge base…</TextShimmer>
      </div>
    );
  }

  if (output?.error) {
    return <p className="text-sm text-destructive px-2">{output.error}</p>;
  }

  const results = output?.results ?? [];
  if (!results.length) {
    return (
      <p className="text-sm text-muted-foreground px-2">
        {output?.message ?? "No relevant document chunks found."}
      </p>
    );
  }

  const panelCitations: ParsedCitation[] = results.map((r) => ({
    index: r.rank,
    quote: r.content.slice(0, 280) + (r.content.length > 280 ? "…" : ""),
    documentTitle: r.source,
    documentId: r.documentId,
    chunkId: r.chunkId,
    relevance:
      r.similarity ?? (r.relevance ? parseFloat(r.relevance) / 100 : undefined),
  }));

  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <BookOpen className="size-4 text-muted-foreground" />
        <span className="text-muted-foreground">{output?.message}</span>
      </div>
      <ul className="space-y-2">
        {results.map((result) => (
          <li
            key={result.chunkId ?? `${result.rank}-${result.source}`}
            className="rounded-md border p-3 space-y-2 bg-muted/20"
          >
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className="text-[10px] h-5">
                #{result.rank}
              </Badge>
              <span className="text-sm font-medium">{result.source}</span>
              {result.relevance && (
                <span className="text-xs text-muted-foreground">
                  {result.relevance} match
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
              {result.content}
            </p>
          </li>
        ))}
      </ul>
      <CitationSourcesPanel citations={panelCitations} projectId={projectId} />
    </div>
  );
}

function PureDocumentSourcesToolInvocation(props: DocumentSourcesToolProps) {
  const toolName = getToolName(props.part);

  if (toolName === DefaultToolName.AnalyzeDocument) {
    return <AnalyzeDocumentToolInvocation {...props} />;
  }

  if (toolName === DefaultToolName.SearchKnowledgeBase) {
    return <SearchKnowledgeBaseToolInvocation {...props} />;
  }

  return null;
}

export const DocumentSourcesToolInvocation = memo(
  PureDocumentSourcesToolInvocation,
  (prev, next) =>
    equal(prev.part, next.part) && prev.projectId === next.projectId,
);

DocumentSourcesToolInvocation.displayName = "DocumentSourcesToolInvocation";
