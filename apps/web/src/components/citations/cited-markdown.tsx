"use client";

import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  extractInlineCitationIndices,
  hasCitationMarkup,
  parseCitations,
  type ParsedCitation,
} from "@/lib/citations/parse-citations";
import { enrichCitationsForDisplay } from "@/lib/citations/enrich-citations";
import type { RetrievalSource } from "@/lib/citations/retrieval-source";
import { Markdown, MarkdownAnchor } from "@/components/markdown";
import { markdownUrlTransform } from "lib/code-runner/artifact-links";
import { CitationMark } from "./citation-mark";
import { CitationSourcesPanel } from "./citation-sources-panel";

const INLINE_CITATION_SPLIT_RE = /(\[\d+\])/g;
const INLINE_CITATION_INDEX_RE = /^\[(\d+)\]$/;

const inlineMarkdownComponents = {
  p: ({ children }: { children?: ReactNode }) => (
    <span className="inline">{children}</span>
  ),
  // Same link handling as the block renderer, or a sandbox:/ link the model
  // wrote next to a citation would still render dead.
  a: MarkdownAnchor,
};

// One memoized text segment between citation marks. Keys are positional and a
// settled segment's string is byte-stable, so while the assistant streams only
// the growing tail segment re-parses; earlier segments skip the ReactMarkdown
// walk entirely. Same settled/tail idea as the block renderer in markdown.tsx.
const CitedTextSegment = memo(function CitedTextSegment({
  segment,
}: {
  segment: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={inlineMarkdownComponents}
      urlTransform={markdownUrlTransform}
    >
      {segment}
    </ReactMarkdown>
  );
});

interface CitedMarkdownProps {
  text: string;
  projectId?: string;
  citations?: ParsedCitation[];
  retrievalSources?: RetrievalSource[];
  isStreaming?: boolean;
}

function CitedMarkdownInner({
  text,
  projectId,
  citations: citationsOverride,
  retrievalSources,
  isStreaming,
}: CitedMarkdownProps) {
  const parsed = useMemo(() => parseCitations(text), [text]);
  const bodyText = citationsOverride ? text : parsed.text;
  const inlineIndices = useMemo(
    () => extractInlineCitationIndices(bodyText),
    [bodyText],
  );
  const citations = useMemo(() => {
    const base = citationsOverride ?? parsed.citations;
    return enrichCitationsForDisplay(base, retrievalSources, inlineIndices);
  }, [citationsOverride, parsed.citations, retrievalSources, inlineIndices]);
  const showSourcesPanel = hasCitationMarkup(text) || inlineIndices.length > 0;

  const segments = useMemo(() => {
    if (!showSourcesPanel) return null;
    return bodyText.split(INLINE_CITATION_SPLIT_RE).filter(Boolean);
  }, [bodyText, showSourcesPanel]);

  if (!segments?.length) {
    return <Markdown isStreaming={isStreaming}>{text}</Markdown>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="leading-6 break-words [&_span]:inline">
        {segments.map((segment, index) => {
          const marker = INLINE_CITATION_INDEX_RE.exec(segment);
          if (marker) {
            const citationIndex = parseInt(marker[1], 10);
            return (
              <CitationMark
                key={`cite-${index}-${citationIndex}`}
                index={citationIndex}
                citations={citations}
                projectId={projectId}
              />
            );
          }

          return <CitedTextSegment key={`text-${index}`} segment={segment} />;
        })}
      </div>
      {showSourcesPanel ? (
        <CitationSourcesPanel citations={citations} projectId={projectId} />
      ) : null}
    </div>
  );
}

export const CitedMarkdown = memo(CitedMarkdownInner);
