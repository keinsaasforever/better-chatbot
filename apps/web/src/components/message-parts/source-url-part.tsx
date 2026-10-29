"use client";

import { cn } from "lib/utils";
import { Download, FileIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

/**
 * A link the app cannot vouch for: a pasted URL, a data: URI, an attachment
 * from before the current storage layout. Uploads no longer reach this —
 * `AttachmentMessagePart` adapts those into the artifact panel first — so this
 * is the fallback for something we can neither fetch nor preview.
 */
export function SourceUrlMessagePart({
  part,
  isUserMessage,
}: {
  part: { type: "source-url"; url: string; title?: string; mediaType?: string };
  isUserMessage: boolean;
}) {
  const t = useTranslations("Chat.Artifact");
  const name = part.title || part.url?.split("/").pop() || "attachment";
  const ext = name.split(".").pop()?.toUpperCase() || "FILE";
  const mediaType =
    part.mediaType && part.mediaType !== "application/octet-stream"
      ? part.mediaType
      : undefined;
  return (
    <div
      className={cn(
        "max-w-md rounded-2xl border border-border/80 p-4 backdrop-blur-sm shadow-sm",
        isUserMessage
          ? "ml-auto bg-accent text-accent-foreground border-accent/40"
          : "mr-auto bg-muted/60 text-foreground",
      )}
    >
      <div className="flex items-start gap-4 max-w-sm">
        <div
          className={cn(
            "flex-shrink-0 rounded-xl p-3",
            isUserMessage ? "bg-accent-foreground/10" : "bg-muted",
          )}
        >
          <FileIcon
            className={cn(
              "size-6",
              isUserMessage
                ? "text-accent-foreground/80"
                : "text-muted-foreground",
            )}
          />
        </div>
        <div className="flex-1 min-w-0 space-y-1 pr-3">
          <a
            href={part.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "text-sm font-medium hover:underline line-clamp-1",
              isUserMessage ? "text-accent-foreground" : "text-foreground",
            )}
            title={name}
          >
            {name}
          </a>
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 text-xs",
              isUserMessage
                ? "text-accent-foreground/70"
                : "text-muted-foreground",
            )}
          >
            <Badge
              variant="outline"
              className={cn(
                "uppercase tracking-wide px-2 py-0.5",
                isUserMessage &&
                  "border-accent-foreground/30 text-accent-foreground/90",
              )}
            >
              {ext}
            </Badge>
            {mediaType && (
              <span className="truncate max-w-[10rem]" title={mediaType}>
                {mediaType}
              </span>
            )}
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              size="icon"
              variant="ghost"
              className={cn(
                "size-9 flex-shrink-0 hover:text-foreground",
                isUserMessage
                  ? "text-accent-foreground/70 hover:text-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <a href={part.url} target="_blank" rel="noopener noreferrer">
                <Download className="size-4" />
                <span className="sr-only">{t("openAttachment")}</span>
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("openAttachment")}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

export function SourceDocumentMessagePart({
  part,
  isUserMessage,
}: {
  part: {
    type: "source-document";
    title: string;
    filename?: string;
    mediaType: string;
  };
  isUserMessage: boolean;
}) {
  const name = part.title || part.filename || "document source";
  const ext = name.split(".").pop()?.toUpperCase() || "DOCUMENT";

  return (
    <div
      className={cn(
        "max-w-md rounded-2xl border border-border/80 p-4 backdrop-blur-sm shadow-sm",
        isUserMessage
          ? "ml-auto bg-accent text-accent-foreground border-accent/40"
          : "mr-auto bg-muted/60 text-foreground",
      )}
    >
      <div className="flex items-start gap-4 max-w-sm">
        <div
          className={cn(
            "flex-shrink-0 rounded-xl p-3",
            isUserMessage ? "bg-accent-foreground/10" : "bg-muted",
          )}
        >
          <FileIcon
            className={cn(
              "size-6",
              isUserMessage
                ? "text-accent-foreground/80"
                : "text-muted-foreground",
            )}
          />
        </div>
        <div className="flex-1 min-w-0 space-y-1 pr-3">
          <p className="text-sm font-medium line-clamp-1" title={name}>
            {name}
          </p>
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 text-xs",
              isUserMessage
                ? "text-accent-foreground/70"
                : "text-muted-foreground",
            )}
          >
            <Badge
              variant="outline"
              className={cn(
                "uppercase tracking-wide px-2 py-0.5",
                isUserMessage &&
                  "border-accent-foreground/30 text-accent-foreground/90",
              )}
            >
              {ext}
            </Badge>
            <span className="truncate max-w-[10rem]" title={part.mediaType}>
              {part.mediaType}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
