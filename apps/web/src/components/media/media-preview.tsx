"use client";

import { cn } from "lib/utils";
import { MediaResource } from "@/types/media";
import { VideoPlayer } from "./video-player";
import { PDFViewer } from "./pdf-viewer";
import { ImageViewer, ImageGallery } from "./image-viewer";
import { AlertTriangle } from "lucide-react";

interface MediaPreviewProps {
  mediaResources: MediaResource[];
  className?: string;
  groupByType?: boolean;
}

interface MediaItemProps {
  media: MediaResource;
  className?: string;
}

/**
 * Single media item renderer
 * Routes to appropriate viewer based on media type
 */
function MediaItem({ media, className }: MediaItemProps) {
  switch (media.type) {
    case "video":
      return (
        <VideoPlayer
          media={media}
          className={className}
          autoPlay={false}
          controls={true}
        />
      );

    case "pdf":
      return <PDFViewer media={media} className={className} height="400px" />;

    case "image":
      return (
        <ImageViewer media={media} className={className} showTooltip={true} />
      );

    case "audio":
      return (
        <div
          className={cn(
            "flex items-center justify-center p-4 bg-card border rounded-lg",
            className,
          )}
        >
          <audio
            controls
            src={media.url}
            className="w-full max-w-md"
            preload="metadata"
          >
            Your browser does not support the audio element.
          </audio>
        </div>
      );

    default:
      return (
        <div
          className={cn(
            "flex flex-col items-center justify-center p-4 bg-card border rounded-lg text-center",
            className,
          )}
        >
          <AlertTriangle className="h-6 w-6 text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Unsupported media type: {media.type}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {media.title || media.url}
          </p>
        </div>
      );
  }
}

/**
 * Unified media preview component
 * Handles all media types (images, videos, PDFs, audio) in a consistent interface
 */
export function MediaPreview({
  mediaResources,
  className,
  groupByType = true,
}: MediaPreviewProps) {
  if (!mediaResources || mediaResources.length === 0) {
    return null;
  }

  // Group media by type for better organization
  if (groupByType) {
    const groupedMedia = mediaResources.reduce(
      (acc, media) => {
        if (!acc[media.type]) {
          acc[media.type] = [];
        }
        acc[media.type].push(media);
        return acc;
      },
      {} as Record<string, MediaResource[]>,
    );

    return (
      <div className={cn("space-y-4", className)}>
        {/* Videos - displayed individually with full controls */}
        {groupedMedia.video && (
          <div className="space-y-3">
            {groupedMedia.video.map((media, index) => (
              <MediaItem
                key={`video-${index}`}
                media={media}
                className="w-full"
              />
            ))}
          </div>
        )}

        {/* Images - displayed as a gallery */}
        {groupedMedia.image && (
          <ImageGallery images={groupedMedia.image} className="mt-2" />
        )}

        {/* PDFs - displayed individually */}
        {groupedMedia.pdf && (
          <div className="space-y-3">
            {groupedMedia.pdf.map((media, index) => (
              <MediaItem
                key={`pdf-${index}`}
                media={media}
                className="w-full"
              />
            ))}
          </div>
        )}

        {/* Audio - displayed individually */}
        {groupedMedia.audio && (
          <div className="space-y-3">
            {groupedMedia.audio.map((media, index) => (
              <MediaItem
                key={`audio-${index}`}
                media={media}
                className="w-full"
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Display all media items in order (no grouping)
  return (
    <div className={cn("space-y-3", className)}>
      {mediaResources.map((media, index) => (
        <MediaItem
          key={`media-${media.type}-${index}`}
          media={media}
          className="w-full"
        />
      ))}
    </div>
  );
}

/**
 * Convenience component for single media item
 */
export function SingleMediaPreview({
  media,
  className,
}: {
  media: MediaResource;
  className?: string;
}) {
  return (
    <MediaPreview
      mediaResources={[media]}
      className={className}
      groupByType={false}
    />
  );
}

/**
 * Helper function to check if MediaResource array contains specific media types
 */
export function hasMediaType(
  mediaResources: MediaResource[],
  type: MediaResource["type"],
): boolean {
  return mediaResources.some((media) => media.type === type);
}

/**
 * Helper function to filter MediaResource array by type
 */
export function filterMediaByType(
  mediaResources: MediaResource[],
  type: MediaResource["type"],
): MediaResource[] {
  return mediaResources.filter((media) => media.type === type);
}

/**
 * Helper function to get media count by type
 */
export function getMediaCounts(
  mediaResources: MediaResource[],
): Record<string, number> {
  return mediaResources.reduce(
    (acc, media) => {
      acc[media.type] = (acc[media.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
}
