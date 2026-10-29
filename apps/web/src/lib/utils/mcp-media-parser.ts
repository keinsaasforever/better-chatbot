/**
 * Enhanced MCP content processor that handles all media types
 * Maintains 100% backward compatibility with existing image processing
 */

import {
  MediaResource,
  MCPMediaResult,
  MCPResourceLink,
  MCPResource,
} from "@/types/media";
import {
  isMorphikContent,
  extractMorphikResults,
  morphikToMediaResources,
  cleanMorphikTags,
} from "./morphik-parser";

// Re-export existing types for backward compatibility
export interface MCPImageInfo {
  url: string;
  description?: string;
  originalText?: string;
}

/**
 * BACKWARD COMPATIBLE: Extracts image URLs from MCP text content that contains [IMAGE_URL] patterns
 * This function maintains the exact same behavior as before
 */
export function extractImagesFromMCPContent(content: any[]): MCPImageInfo[] {
  if (!Array.isArray(content)) return [];

  const images: MCPImageInfo[] = [];

  content.forEach((item) => {
    if (item?.type === "text" && typeof item?.text === "string") {
      const text = item.text;

      // Match [IMAGE_URL]https://...[/IMAGE_URL] or [IMAGE_URL]https://... patterns
      // This handles both wrapped and unwrapped formats
      const imageUrlRegex =
        /\[IMAGE_URL\](https?:\/\/[^\s\]]+?)(?:\[\/IMAGE_URL\]|(?=\s|$|\[))/gi;
      let match;

      while ((match = imageUrlRegex.exec(text)) !== null) {
        let url = match[1];

        // Additional cleanup: remove any trailing [/IMAGE_URL] that might have been captured
        url = url.replace(/\[\/IMAGE_URL\]$/, "").trim();

        // Try to extract description from surrounding text
        const beforeMatch = text.substring(0, match.index).trim();
        const afterMatch = text.substring(match.index + match[0].length).trim();

        // Use the text before or after as description, or fallback to filename
        let description = "";
        if (beforeMatch) {
          // Take last sentence/phrase before the image URL
          const sentences = beforeMatch.split(/[.!?]\s+/);
          description = sentences[sentences.length - 1]?.trim() || "";
        }

        if (!description && afterMatch) {
          // Take first sentence/phrase after the image URL
          const sentences = afterMatch.split(/[.!?]\s+/);
          description = sentences[0]?.trim() || "";
        }

        if (!description) {
          // Fallback to filename from URL
          try {
            const urlPath = new URL(url).pathname;
            const filename = urlPath.split("/").pop() || "";
            description = filename.split(".")[0] || "Image";
          } catch {
            description = "Image";
          }
        }

        images.push({
          url,
          description:
            description.length > 100
              ? description.substring(0, 100) + "..."
              : description,
          originalText: match[0],
        });
      }
    }
  });

  return images;
}

/**
 * BACKWARD COMPATIBLE: Removes image URL patterns from text content for cleaner display
 * Now handles both [IMAGE_URL]url and [IMAGE_URL]url[/IMAGE_URL] formats
 */
export function cleanTextFromImageUrls(text: string): string {
  return text
    .replace(
      /\[IMAGE_URL\]https?:\/\/[^\s\]]+?(?:\[\/IMAGE_URL\]|(?=\s|$|\[))/gi,
      "",
    )
    .trim();
}

/**
 * ENHANCED: Processes all MCP content block types while maintaining backward compatibility
 */
export function processMCPContentEnhanced(
  content: any[],
  structuredContent?: any,
): MCPMediaResult {
  // Check for Morphik-specific format first
  if (isMorphikContent(content)) {
    console.log("Detected Morphik MCP content, using specialized parser");
    const morphikResults = extractMorphikResults(content);
    const morphikMedia = morphikToMediaResources(morphikResults);

    // Clean text content from Morphik tags
    const cleanedContent = content.map((item) => {
      if (item?.type === "text" && typeof item?.text === "string") {
        return {
          ...item,
          text: cleanMorphikTags(item.text),
        };
      }
      return item;
    });

    // Extract summary text after cleaning tags
    let textContent = "";
    cleanedContent.forEach((item) => {
      if (item?.type === "text" && typeof item?.text === "string") {
        textContent += item.text + "\n";
      }
    });

    return {
      mediaResources: morphikMedia,
      images: [], // Morphik uses MediaResources instead of legacy images
      textContent: textContent.trim(),
      cleanedContent,
      structuredData: structuredContent,
    };
  }

  // Start with backward compatible image processing for non-Morphik content
  const legacyImages = extractImagesFromMCPContent(content);
  const mediaResources: MediaResource[] = [];
  let textContent = "";

  // Convert legacy images to new MediaResource format
  legacyImages.forEach((img) => {
    mediaResources.push({
      type: "image",
      url: img.url,
      mimeType: "image/jpeg", // Assume JPEG for legacy [IMAGE_URL] markers
      description: img.description,
      metadata: {},
    });
  });

  // Process content blocks for enhanced MCP support (future MCP servers)
  if (Array.isArray(content)) {
    content.forEach((block) => {
      switch (block?.type) {
        case "text":
          if (typeof block.text === "string") {
            textContent += cleanTextFromImageUrls(block.text) + "\n";
          }
          break;

        case "resource_link":
          const resourceLink = block as MCPResourceLink;
          mediaResources.push({
            type: detectMediaType(resourceLink.mimeType),
            url: resourceLink.uri,
            mimeType: resourceLink.mimeType || "application/octet-stream",
            title: resourceLink.title,
            description: resourceLink.description,
            metadata: {},
          });
          break;

        case "resource":
          const resource = block as MCPResource;
          if (resource.resource.text) {
            textContent += resource.resource.text + "\n";
          } else if (resource.resource.blob) {
            // Handle base64 blob resources (not recommended for large media)
            mediaResources.push({
              type: detectMediaType(resource.resource.mimeType),
              url: `data:${resource.resource.mimeType};base64,${resource.resource.blob}`,
              mimeType:
                resource.resource.mimeType || "application/octet-stream",
              metadata: {},
            });
          }
          break;

        case "image":
        case "audio":
          // Handle base64 media blocks (MCP spec compliance)
          if (block.data && block.mimeType) {
            mediaResources.push({
              type: block.type,
              url: `data:${block.mimeType};base64,${block.data}`,
              mimeType: block.mimeType,
              metadata: {},
            });
          }
          break;
      }
    });
  }

  // Clean content for backward compatibility
  const cleanedContent = content.map((item) => {
    if (item?.type === "text" && typeof item?.text === "string") {
      return {
        ...item,
        text: cleanTextFromImageUrls(item.text),
      };
    }
    return item;
  });

  return {
    mediaResources,
    images: legacyImages, // Maintain backward compatibility
    textContent: textContent.trim(),
    cleanedContent,
    structuredData: structuredContent,
  };
}

/**
 * BACKWARD COMPATIBLE: Original function signature maintained for existing code
 */
export function processMCPContent(content: any[]) {
  const result = processMCPContentEnhanced(content);

  // Return original format for backward compatibility
  return {
    images: result.images,
    cleanedContent: result.cleanedContent,
  };
}

/**
 * NEW: Normalize workflow video responses to MediaResource format
 * Handles both flat Twelve Labs format and nested HTTP response format
 */
export function normalizeWorkflowVideoResponse(
  workflowResult: any,
): MediaResource[] {
  if (!workflowResult) return [];

  // Find the array data from multiple possible locations
  let arrayData: any[] | null = null;

  if (Array.isArray(workflowResult.data)) {
    arrayData = workflowResult.data;
  } else if (Array.isArray(workflowResult.output)) {
    arrayData = workflowResult.output;
  } else if (Array.isArray(workflowResult)) {
    arrayData = workflowResult;
  }

  if (!arrayData) {
    console.log("normalizeWorkflowVideoResponse: No array data found in:", {
      hasData: !!workflowResult.data,
      hasOutput: !!workflowResult.output,
      isArray: Array.isArray(workflowResult),
      keys: Object.keys(workflowResult || {}),
    });
    return [];
  }

  console.log(
    `normalizeWorkflowVideoResponse: Processing ${arrayData.length} items`,
  );

  return arrayData
    .filter((item: any) => {
      // Skip 404s and other failed responses
      if (item?.statusCode === 404 || item?.error) return false;

      // Check if this item has a valid video URL
      const isHttpResponse = item.body && typeof item.body === "object";

      if (isHttpResponse) {
        // Check for n8n HTTP response format - must have video URL
        return !!item.body?.hls?.video_url;
      } else {
        // Check for legacy flat format - must have both video_id and thumbnail_url
        return item.video_id && item.thumbnail_url;
      }
    })
    .map((item: any) => {
      // Check if this is an HTTP response format (n8n style)
      const isHttpResponse = item.body && typeof item.body === "object";

      if (isHttpResponse) {
        // Handle n8n HTTP response format
        const body = item.body;
        const hls = body.hls;
        const systemMetadata = body.system_metadata || {};

        // We know videoUrl exists because we filtered for it
        const videoUrl = hls.video_url;
        const thumbnailUrl =
          body.thumbnail_urls?.[0] ||
          body.thumbnail_url ||
          hls?.thumbnail_url ||
          hls?.thumbnail_urls?.[0]; // Add missing thumbnail path

        console.log("Processing HTTP video item:", {
          hasVideoUrl: !!videoUrl,
          hasThumbnail: !!thumbnailUrl,
          thumbnailSources: {
            bodyThumbnailUrls: !!body.thumbnail_urls?.[0],
            bodyThumbnailUrl: !!body.thumbnail_url,
            hlsThumbnailUrl: !!hls?.thumbnail_url,
            hlsThumbnailUrls: !!hls?.thumbnail_urls?.[0],
          },
        });

        // No need to check videoUrl again - we know it exists

        return {
          type: "video" as const,
          url: videoUrl, // Direct .m3u8 URL - no resolution needed!
          mimeType: "application/vnd.apple.mpegurl",
          title: systemMetadata.title || `Video Clip`,
          description:
            systemMetadata.description ||
            body.transcription ||
            "Video clip from search results",
          thumbnail: thumbnailUrl,
          metadata: {
            duration: systemMetadata.duration || hls?.duration,
            startTime: body.start || systemMetadata.start_time,
            endTime: body.end || systemMetadata.end_time,
            confidence: body.confidence || systemMetadata.confidence,
            score: body.score || systemMetadata.score,
            transcription: body.transcription || systemMetadata.transcription,
            video_id: body.video_id || systemMetadata.video_id,
            // Additional metadata from system_metadata
            ...systemMetadata,
          },
        };
      } else {
        // Handle legacy flat format (backward compatibility)
        return {
          type: "video" as const,
          url: item.video_id, // Will be resolved to HLS URL by video player (legacy behavior)
          mimeType: "application/vnd.apple.mpegurl",
          title: `Video Clip (${item.start}s - ${item.end}s)`,
          description:
            item.transcription ||
            `Clip with ${item.confidence} confidence, score: ${item.score}%`,
          thumbnail: item.thumbnail_url,
          metadata: {
            duration: item.end - item.start,
            startTime: item.start,
            endTime: item.end,
            confidence: item.confidence,
            score: item.score,
            transcription: item.transcription,
            video_id: item.video_id, // Keep for HLS URL resolution
          },
        };
      }
    })
    .filter(Boolean); // Remove null entries
}

/**
 * Utility: Detect media type from MIME type
 */
function detectMediaType(mimeType?: string): MediaResource["type"] {
  if (!mimeType) return "image"; // Default fallback

  if (mimeType.startsWith("image/")) return "image";
  if (
    mimeType.startsWith("video/") ||
    mimeType === "application/vnd.apple.mpegurl"
  )
    return "video";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("audio/")) return "audio";

  return "image"; // Default fallback
}
