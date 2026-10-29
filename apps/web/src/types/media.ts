/**
 * Unified media types for handling images, videos, PDFs, and audio
 * Used by both MCP processing and workflow result normalization
 */

export type MediaType = "image" | "video" | "pdf" | "audio";

export interface MediaResource {
  type: MediaType;
  url: string;
  mimeType: string;
  title?: string;
  description?: string;
  thumbnail?: string;
  metadata?: MediaMetadata;
}

export interface MediaMetadata {
  // Video-specific metadata
  duration?: number;
  startTime?: number;
  endTime?: number;
  confidence?: "high" | "medium" | "low";
  score?: number;
  transcription?: string;
  video_id?: string; // For HLS URL resolution

  // Image-specific metadata
  width?: number;
  height?: number;

  // PDF-specific metadata
  pages?: number;
  isPdf?: boolean;
  showFullDocumentLink?: boolean;
  fullDocumentUrl?: string;
  sourceUrl?: string; // Original source URL (for Morphik results)

  // Audio-specific metadata
  bitrate?: number;
  sampleRate?: number;

  // Generated files: `url` is the inline (preview) form; this is the target a
  // Download button should use.
  downloadUrl?: string;
}

/**
 * Result structure for enhanced MCP content processing
 * Maintains backward compatibility with existing image processing
 */
export interface MCPMediaResult {
  // New unified media resources
  mediaResources: MediaResource[];

  // Backward compatibility with existing image processing
  images: Array<{
    url: string;
    description?: string;
    originalText?: string;
  }>;

  // Cleaned text content
  textContent: string;
  cleanedContent: any[];

  // Optional structured data from workflow responses
  structuredData?: any;
}

/**
 * Workflow-specific types for Twelve Labs responses
 */
export interface WorkflowVideoClip {
  video_id: string;
  thumbnail_url: string;
  transcription?: string;
  score: number;
  confidence: "high" | "medium" | "low";
  start: number;
  end: number;
}

export interface WorkflowVideoResponse {
  data: WorkflowVideoClip[];
  search_pool: {
    total_count: number;
    total_duration: number;
    index_id: string;
  };
  query?: string;
}

/**
 * MCP Resource Link structure (for future MCP server integration)
 */
export interface MCPResourceLink {
  type: "resource_link";
  name: string;
  uri: string;
  mimeType?: string;
  title?: string;
  description?: string;
}

/**
 * MCP Resource structure
 */
export interface MCPResource {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  };
}
