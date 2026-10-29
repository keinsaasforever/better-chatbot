/**
 * Media components for handling images, videos, PDFs, and audio
 * Provides unified interface for all media types
 */

// Main components
export { MediaPreview, SingleMediaPreview } from "./media-preview";
export { VideoPlayer } from "./video-player";
export { PDFViewer } from "./pdf-viewer";
export {
  ImageViewer,
  ImageGallery,
  MCPImageGalleryCompat,
} from "./image-viewer";

// Helper functions
export {
  hasMediaType,
  filterMediaByType,
  getMediaCounts,
} from "./media-preview";

// Re-export types for convenience
export type { MediaResource, MediaType, MediaMetadata } from "@/types/media";
