"use client";

import { FileUIPart } from "ai";
import { notify } from "lib/notify";
import { cn } from "lib/utils";
import { Download, FileIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

// File Message Part Component
interface FileMessagePartProps {
  part: FileUIPart; // FileUIPart from AI SDK
  isUserMessage: boolean;
}

export const FileMessagePart = memo(
  ({ part, isUserMessage }: FileMessagePartProps) => {
    const t = useTranslations("Chat");
    const isImage = part.mediaType?.startsWith("image/");

    const fileExtension =
      part.filename?.split(".").pop()?.toUpperCase() ||
      part.mediaType?.split("/").pop()?.toUpperCase() ||
      "FILE";

    // Convert storage path to public URL if needed
    let fileUrl: string | undefined = part.url;
    if (
      fileUrl &&
      !fileUrl.startsWith("http") &&
      !fileUrl.startsWith("data:")
    ) {
      // Public bucket: construct direct URL. Without a configured Supabase
      // project there is no URL to build, so drop the link and render the
      // attachment without a preview or download action.
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      fileUrl = supabaseUrl
        ? `${supabaseUrl}/storage/v1/object/public/attachments/${fileUrl}`
        : undefined;
    }

    const filename =
      part.filename || part.url?.split("/").pop() || "Attachment";
    const secondaryLabel =
      part.mediaType && part.mediaType !== "application/octet-stream"
        ? part.mediaType
        : undefined;

    if (isImage && fileUrl) {
      const url = fileUrl;
      // A compact chip in the thread; the full-size photo only on demand. A
      // renovation thread carries the same source photo many times over, and
      // rendering each at full width buried the conversation under it.
      const openFullSize = () =>
        notify.component({
          className: "max-w-[90vw]! max-h-[90vh]! p-6!",
          children: (
            <div className="flex flex-col h-full gap-4">
              <div className="flex-1 flex items-center justify-center min-h-0 py-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  className="max-w-[80vw] max-h-[80vh] object-contain rounded-lg"
                  alt={filename}
                />
              </div>
              <div className="flex items-center justify-center gap-3 text-sm text-muted-foreground">
                <span className="truncate max-w-[60vw]">{filename}</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-foreground hover:underline"
                >
                  <Download className="size-4" />
                  {t("attachmentDownload")}
                </a>
              </div>
            </div>
          ),
        });

      return (
        <button
          type="button"
          onClick={openFullSize}
          title={t("attachmentOpenImage")}
          className={cn(
            "group flex max-w-xs items-center gap-3 rounded-2xl border p-2 pr-4 text-left shadow-sm transition-colors",
            isUserMessage
              ? "ml-auto bg-accent text-accent-foreground border-accent/40 hover:bg-accent/80"
              : "mr-auto bg-muted/60 text-foreground border-border/80 hover:bg-muted",
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={filename}
            loading="lazy"
            className="size-14 flex-shrink-0 rounded-xl object-cover"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" title={filename}>
              {filename}
            </p>
            <p
              className={cn(
                "text-xs",
                isUserMessage
                  ? "text-accent-foreground/70"
                  : "text-muted-foreground",
              )}
            >
              {t("attachmentOpenImage")}
            </p>
          </div>
        </button>
      );
    }

    // Non-image file
    return (
      <div
        className={cn(
          "max-w-md rounded-2xl border border-border/80 p-4 shadow-sm backdrop-blur-sm",
          isUserMessage
            ? "ml-auto bg-accent text-accent-foreground border-accent/40"
            : "mr-auto bg-muted/60 text-foreground",
        )}
      >
        <div className="flex items-start gap-4">
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
            <p
              className={cn(
                "text-sm font-medium line-clamp-1",
                isUserMessage ? "text-accent-foreground" : "text-foreground",
              )}
              title={filename}
            >
              {filename}
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
                {fileExtension}
              </Badge>
              {secondaryLabel && (
                <span
                  className={cn(
                    "truncate max-w-[10rem]",
                    isUserMessage
                      ? "text-accent-foreground/70"
                      : "text-muted-foreground",
                  )}
                  title={secondaryLabel}
                >
                  {secondaryLabel}
                </span>
              )}
            </div>
          </div>
          {fileUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "size-9 flex-shrink-0 hover:text-foreground",
                    isUserMessage
                      ? "text-accent-foreground/70 hover:text-accent-foreground"
                      : "text-muted-foreground",
                  )}
                  onClick={() => {
                    // If already a full URL, use as-is
                    // Otherwise it should already be a public URL from the chat API
                    window.open(fileUrl, "_blank");
                  }}
                >
                  <Download className="size-4" />
                  <span className="sr-only">
                    {t("attachmentDownload")} {filename}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("attachmentDownload")}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    );
  },
);

FileMessagePart.displayName = "FileMessagePart";
