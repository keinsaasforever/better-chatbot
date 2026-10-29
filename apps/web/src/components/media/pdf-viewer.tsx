"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "ui/button";
import { cn } from "lib/utils";
import { ExternalLink, Download, AlertTriangle, FileText } from "lucide-react";
import { MediaResource } from "@/types/media";
import { inlinePreviewUrl } from "lib/code-runner/artifact-media";

interface PDFViewerProps {
  media: MediaResource;
  className?: string;
  height?: string;
}

export function PDFViewer({
  media,
  className,
  height = "600px",
}: PDFViewerProps) {
  const t = useTranslations("Chat.Tool");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);
  const title = media.title || t("pdfDocument");
  // Rendering must ask for the inline variant. Our storage route answers
  // `Content-Disposition: attachment` by default, and an iframe pointed at an
  // attachment does not render it — the browser saves the file instead, on
  // every mount. That is what made opening a thread re-download its PDF.
  const previewUrl = inlinePreviewUrl(media.url);
  // Saving keeps the attachment URL, so the file arrives with its own name.
  const downloadUrl = media.metadata?.downloadUrl ?? media.url;

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  const handleThumbnailError = () => {
    setThumbnailError(true);
  };

  const openInNewTab = () => {
    window.open(previewUrl, "_blank", "noopener,noreferrer");
  };

  const downloadPDF = () => {
    const link = document.createElement("a");
    // No target="_blank": a download anchor never navigates, and the desktop
    // shell used to get a blank window from the extra target.
    link.href = downloadUrl;
    link.download = media.title || "document.pdf";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Show thumbnail preview if available and PDF failed to load or is loading
  const showThumbnail =
    media.thumbnail && !thumbnailError && (hasError || isLoading);

  if (hasError && !showThumbnail) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center p-6 bg-card border rounded-lg text-center",
          className,
        )}
        style={{ height }}
      >
        <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
        <p className="text-sm text-muted-foreground mb-4">
          {t("pdfLoadFailed")}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={openInNewTab}
            className="flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            {t("openInNewTab")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadPDF}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            {t("download")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative bg-card border rounded-lg overflow-hidden",
        className,
      )}
    >
      {/* Header with PDF info and controls */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{title}</p>
            {media.description && (
              <p className="text-xs text-muted-foreground">
                {media.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={openInNewTab}
            className="h-8 px-2"
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={downloadPDF}
            className="h-8 px-2"
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* PDF iframe container or thumbnail preview */}
      <div className="relative" style={{ height }}>
        {/* Show thumbnail preview while loading or if PDF failed but thumbnail available */}
        {showThumbnail && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/20 p-4">
            <div className="flex flex-col items-center gap-4 max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={media.thumbnail}
                alt={t("pdfPreviewAlt", { title })}
                className="max-w-full max-h-[400px] object-contain rounded shadow-lg"
                onError={handleThumbnailError}
              />
              {isLoading && (
                <div className="flex flex-col items-center gap-2">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                  <p className="text-sm text-muted-foreground">
                    {t("pdfLoadingFull")}
                  </p>
                </div>
              )}
              {hasError && (
                <p className="text-sm text-muted-foreground">
                  {t("pdfPreviewOnly")}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Loading spinner (shown only if no thumbnail available) */}
        {isLoading && !showThumbnail && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/20">
            <div className="flex flex-col items-center gap-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <p className="text-sm text-muted-foreground">{t("pdfLoading")}</p>
            </div>
          </div>
        )}

        {/* PDF iframe */}
        <iframe
          src={`${previewUrl}#toolbar=1&navpanes=1&scrollbar=1&page=1&view=FitH`}
          className="w-full h-full border-0"
          title={title}
          onLoad={handleLoad}
          onError={handleError}
          style={{
            display: isLoading || showThumbnail ? "none" : "block",
            minHeight: height,
          }}
        />
      </div>

      {/* Metadata footer */}
      {media.metadata?.pages && (
        <div className="px-3 py-2 border-t bg-muted/30 text-xs text-muted-foreground">
          {t("pdfPages", { count: media.metadata.pages })}
        </div>
      )}
    </div>
  );
}
