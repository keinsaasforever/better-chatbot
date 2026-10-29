"use client";

import React, {
  type ComponentPropsWithoutRef,
  memo,
  PropsWithChildren,
  useContext,
  useMemo,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { PreBlock } from "./pre-block";
import { MarkdownStreamingContext } from "./markdown-streaming-context";
import { MessageArtifactsContext } from "./message-artifacts-context";
import {
  isAppDownloadHref,
  isSandboxLikeHref,
  markdownUrlTransform,
  resolveArtifactLink,
} from "lib/code-runner/artifact-links";
import { inlinePreviewUrl } from "lib/code-runner/artifact-media";
import { parseMarkdownIntoBlocks } from "lib/markdown-blocks";
import { isJson, isString, toAny } from "lib/utils";
import JsonView from "ui/json-view";
import { DownloadIcon, LinkIcon } from "lucide-react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "ui/table";

const FadeIn = memo(({ children }: PropsWithChildren) => {
  return <span className="fade-in animate-in duration-1000">{children} </span>;
});
FadeIn.displayName = "FadeIn";

export const WordByWordFadeIn = memo(({ children }: PropsWithChildren) => {
  // Only the still-streaming block pays for per-word spans + fade. Settled
  // blocks render plain text, so a long answer keeps O(tail) elements, not O(n).
  const streaming = useContext(MarkdownStreamingContext);
  if (!streaming) return <>{children}</>;
  const childrens = [children]
    .flat()
    .flatMap((child) => (isString(child) ? child.split(" ") : child));
  return childrens.map((word, index) =>
    isString(word) ? <FadeIn key={index}>{word}</FadeIn> : word,
  );
});
WordByWordFadeIn.displayName = "WordByWordFadeIn";

type MarkdownAnchorProps = ComponentPropsWithoutRef<"a"> & { node?: unknown };

const DownloadAnchor = ({
  href,
  filename,
  children,
}: PropsWithChildren<{ href: string; filename?: string }>) => (
  // A plain download anchor: no target="_blank", so the click never opens a
  // tab, and on the desktop shell never a window.
  <a
    className="text-primary hover:underline inline-flex gap-1.5 items-center"
    href={href}
    download={filename ?? true}
  >
    <DownloadIcon className="size-3.5" />
    <WordByWordFadeIn>{children}</WordByWordFadeIn>
  </a>
);

/**
 * Links in assistant text. Beyond an ordinary external link:
 * - an empty href renders as text. react-markdown blanks unsafe schemes
 *   rather than dropping the link, and an empty href points at the current
 *   page — on the desktop shell that opened a second window;
 * - a sandbox-style link to a generated file (sandbox:/home/user/report.xlsx,
 *   report.xlsx) becomes that file's real download when this message produced
 *   it, and plain text when it did not;
 * - the app's own download route renders as a download anchor.
 */
export const MarkdownAnchor = ({
  node,
  children,
  ...props
}: MarkdownAnchorProps) => {
  const artifacts = useContext(MessageArtifactsContext);
  const { href } = props;
  if (!href) {
    return <span>{children}</span>;
  }
  if (isSandboxLikeHref(href)) {
    const match = resolveArtifactLink(href, artifacts);
    if (!match?.url) return <span>{children}</span>;
    return (
      <DownloadAnchor href={match.url} filename={match.filename}>
        {children}
      </DownloadAnchor>
    );
  }
  if (isAppDownloadHref(href)) {
    return <DownloadAnchor href={href}>{children}</DownloadAnchor>;
  }
  return (
    <a
      className="text-primary hover:underline flex gap-1.5 items-center"
      target="_blank"
      rel="noreferrer"
      {...toAny(props)}
    >
      <LinkIcon className="size-3.5" />
      <WordByWordFadeIn>{children}</WordByWordFadeIn>
    </a>
  );
};

type MarkdownImageProps = ComponentPropsWithoutRef<"img"> & { node?: unknown };

/** Images; a sandbox-style src resolves to the generated file's inline URL. */
const MarkdownImage = ({ node, ...props }: MarkdownImageProps) => {
  const artifacts = useContext(MessageArtifactsContext);
  const { src, alt, ...rest } = props;
  if (typeof src !== "string" || src.length === 0) return null;

  let resolved: string | undefined = src;
  if (isSandboxLikeHref(src)) {
    const match = resolveArtifactLink(src, artifacts);
    resolved = match?.url ? inlinePreviewUrl(match.url) : undefined;
  }
  return resolved ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="mx-auto rounded-lg" src={resolved} alt={alt} {...rest} />
  ) : null;
};

const components: Partial<Components> = {
  table: ({ node, children, ...props }) => {
    return (
      <div className="my-4">
        <Table {...props}>{children}</Table>
      </div>
    );
  },
  thead: ({ node, children, ...props }) => {
    return <TableHeader {...props}>{children}</TableHeader>;
  },
  tbody: ({ node, children, ...props }) => {
    return <TableBody {...props}>{children}</TableBody>;
  },
  tr: ({ node, children, ...props }) => {
    return <TableRow {...props}>{children}</TableRow>;
  },
  th: ({ node, children, ...props }) => {
    return (
      <TableHead {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </TableHead>
    );
  },
  td: ({ node, children, ...props }) => {
    return (
      <TableCell {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </TableCell>
    );
  },
  code: ({ children }) => {
    return (
      <code className="text-sm rounded-md bg-accent text-primary py-1 px-2 mx-0.5">
        {children}
      </code>
    );
  },
  blockquote: ({ children }) => {
    return (
      <div className="px-4">
        <blockquote className="relative bg-accent/30 p-6 rounded-2xl my-6 overflow-hidden border">
          <WordByWordFadeIn>{children}</WordByWordFadeIn>
        </blockquote>
      </div>
    );
  },
  p: ({ children }) => {
    return (
      <p className="leading-6 my-4 break-words">
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </p>
    );
  },
  pre: ({ children }) => {
    return (
      <div className="px-4 py-2">
        <PreBlock>{children}</PreBlock>
      </div>
    );
  },
  ol: ({ node, children, ...props }) => {
    return (
      <ol className="px-8 list-decimal list-outside" {...props}>
        {children}
      </ol>
    );
  },
  li: ({ node, children, ...props }) => {
    return (
      <li className="py-2 break-words" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </li>
    );
  },
  ul: ({ node, children, ...props }) => {
    return (
      <ul className="px-8 list-outside list-disc" {...props}>
        {children}
      </ul>
    );
  },
  strong: ({ node, children, ...props }) => {
    return (
      <span className="font-semibold" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </span>
    );
  },
  a: MarkdownAnchor,
  h1: ({ node, children, ...props }) => {
    return (
      <h1 className="text-3xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h1>
    );
  },
  h2: ({ node, children, ...props }) => {
    return (
      <h2 className="text-2xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h2>
    );
  },
  h3: ({ node, children, ...props }) => {
    return (
      <h3 className="text-xl font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h3>
    );
  },
  h4: ({ node, children, ...props }) => {
    return (
      <h4 className="text-lg font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h4>
    );
  },
  h5: ({ node, children, ...props }) => {
    return (
      <h5 className="text-base font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h5>
    );
  },
  h6: ({ node, children, ...props }) => {
    return (
      <h6 className="text-sm font-semibold mt-6 mb-2" {...props}>
        <WordByWordFadeIn>{children}</WordByWordFadeIn>
      </h6>
    );
  },
  img: MarkdownImage,
};

const MarkdownBlock = memo(
  ({ content, isStreaming }: { content: string; isStreaming: boolean }) => (
    <MarkdownStreamingContext.Provider value={isStreaming}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={markdownUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </MarkdownStreamingContext.Provider>
  ),
  (prev, next) =>
    prev.content === next.content && prev.isStreaming === next.isStreaming,
);
MarkdownBlock.displayName = "MarkdownBlock";

const NonMemoizedMarkdown = ({
  children,
  isStreaming = false,
}: {
  children: string;
  isStreaming?: boolean;
}) => {
  // Block-level split so a streaming update only re-parses the growing tail
  // block; settled blocks are byte-stable and skipped by MarkdownBlock's memo.
  const blocks = useMemo(
    () => (isJson(children) ? null : parseMarkdownIntoBlocks(children)),
    [children],
  );
  return (
    <article className="w-full h-full relative">
      {blocks === null ? (
        <JsonView data={children} />
      ) : (
        blocks.map((block, index) => (
          <MarkdownBlock
            key={index}
            content={block}
            isStreaming={isStreaming && index === blocks.length - 1}
          />
        ))
      )}
    </article>
  );
};

export const Markdown = memo(
  NonMemoizedMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.isStreaming === nextProps.isStreaming,
);
