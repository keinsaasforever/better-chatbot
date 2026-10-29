"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { notify } from "lib/notify";
import { cn } from "lib/utils";
import { MediaResource } from "@/types/media";
import { Button } from "ui/button";
import { ExternalLink, FileText } from "lucide-react";

interface ImageViewerProps {
  media: MediaResource;
  className?: string;
  showTooltip?: boolean;
}

interface ImageGalleryProps {
  images: MediaResource[];
  className?: string;
}

/**
 * Single image viewer component
 * Reuses the logic from MCPImageGallery but works with MediaResource
 */
export function ImageViewer({
  media,
  className,
  showTooltip = true,
}: ImageViewerProps) {
  const [hasError, setHasError] = useState(false);

  // Debug logging for Morphik previews
  if (media.thumbnail) {
    console.log(
      `[ImageViewer] Has thumbnail: ${media.thumbnail.substring(0, 50)}... (${media.thumbnail.length} chars)`,
    );
  } else {
    console.log(
      `[ImageViewer] No thumbnail, using URL: ${media.url.substring(0, 100)}`,
    );
  }

  const handleError = () => {
    console.error(
      `[ImageViewer] Failed to load image: ${media.title || "Untitled"}`,
    );
    console.error(
      `[ImageViewer] Attempted source: ${media.thumbnail ? "thumbnail (base64)" : "URL"}`,
    );
    console.error(
      `[ImageViewer] URL prefix: ${media.url.substring(0, 100)}...`,
    );
    if (media.thumbnail) {
      console.error(
        `[ImageViewer] Thumbnail prefix: ${media.thumbnail.substring(0, 100)}...`,
      );
    }
    setHasError(true);
  };

  const handleClick = () => {
    notify.component({
      className: "max-w-[90vw]! max-h-[90vh]! p-6!",
      children: (
        <div className="flex flex-col h-full gap-4">
          <div className="flex-1 flex items-center justify-center min-h-0 py-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={media.thumbnail || media.url}
              className="max-w-[80vw] max-h-[80vh] object-contain rounded-lg"
              alt={media.description || media.title}
              onError={handleError}
            />
          </div>
          {(media.description || media.title) && (
            <div className="text-center text-sm text-muted-foreground">
              {media.description || media.title}
            </div>
          )}
          {/* Additional metadata */}
          {media.metadata && (
            <div className="text-center text-xs text-muted-foreground space-y-1">
              {media.metadata.width && media.metadata.height && (
                <div>
                  {media.metadata.width} × {media.metadata.height}
                </div>
              )}
              {media.mimeType && media.mimeType !== "image/jpeg" && (
                <div>{media.mimeType}</div>
              )}
            </div>
          )}
          {/* View Full Document button for Morphik results */}
          {media.metadata?.showFullDocumentLink &&
            media.metadata?.fullDocumentUrl && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    window.open(
                      media.metadata!.fullDocumentUrl as string,
                      "_blank",
                    )
                  }
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  {media.metadata.isPdf
                    ? "View Full PDF"
                    : "View Full Document"}
                </Button>
              </div>
            )}
        </div>
      ),
    });
  };

  if (hasError) {
    return (
      <div
        className={cn(
          "flex items-center justify-center w-full h-36 bg-muted rounded-lg border",
          className,
        )}
      >
        <p className="text-sm text-muted-foreground">Failed to load image</p>
      </div>
    );
  }

  const imageElement = (
    <div
      onClick={handleClick}
      className={cn(
        "relative block shadow rounded-lg overflow-hidden ring ring-input cursor-pointer hover:ring-primary/50 transition-all duration-200",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        loading="lazy"
        src={media.thumbnail || media.url}
        alt={media.description || media.title}
        className="w-full max-h-[400px] object-contain bg-muted hover:scale-[1.02] transition-transform duration-300"
        onError={handleError}
      />
      {/* PDF badge indicator */}
      {media.metadata?.isPdf && (
        <div className="absolute top-2 right-2 bg-background/90 backdrop-blur-sm rounded px-2 py-1 flex items-center gap-1 shadow-sm">
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">PDF</span>
        </div>
      )}
      {/* Relevance score badge */}
      {media.metadata?.score && (
        <div className="absolute top-2 left-2 bg-primary/90 backdrop-blur-sm rounded px-2 py-1 shadow-sm">
          <span className="text-xs font-medium text-primary-foreground">
            {(media.metadata.score as number).toFixed(1)}
          </span>
        </div>
      )}
    </div>
  );

  if (!showTooltip) {
    return imageElement;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-block w-full">{imageElement}</div>
      </TooltipTrigger>
      <TooltipContent className="p-4 max-w-xs whitespace-pre-wrap break-words pointer-events-none">
        <p className="text-xs text-muted-foreground">
          {media.description || media.title || media.url}
        </p>
        {/* Show additional metadata in tooltip */}
        {media.metadata?.width && media.metadata?.height && (
          <p className="text-xs text-muted-foreground mt-1">
            {media.metadata.width} × {media.metadata.height}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Image gallery component for multiple images
 * Compatible with existing MCPImageGallery usage patterns
 */
export function ImageGallery({ images, className }: ImageGalleryProps) {
  const [errorSrc] = useState<string[]>([]);

  // Filter out images that failed to load
  const validImages = images.filter(
    (image) => image.type === "image" && !errorSrc.includes(image.url),
  );

  if (validImages.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2 mt-2", className)}>
      {validImages.map((image, i) => (
        <ImageViewer
          key={`${image.url}-${i}`}
          media={image}
          showTooltip={true}
        />
      ))}
    </div>
  );
}

/**
 * Backward compatibility: Convert MCPImageInfo to MediaResource
 * This allows existing code to work with the new ImageGallery
 */
export function MCPImageGalleryCompat({
  images,
}: {
  images: Array<{ url: string; description?: string; originalText?: string }>;
}) {
  const mediaResources: MediaResource[] = images.map((img) => ({
    type: "image" as const,
    url: img.url,
    mimeType: "image/jpeg", // Default assumption for legacy images
    description: img.description,
    metadata: {},
  }));

  return <ImageGallery images={mediaResources} />;
}
