/**
 * Parser for Morphik MCP responses
 * Handles the special format: [IMAGE_URL]...[TITLE]...[SCORE]...[DOC_URL]...[PREVIEW]...
 */

import { MediaResource } from "@/types/media";

export interface MorphikResult {
  imageUrl: string;
  title?: string;
  score?: number;
  docUrl?: string;
  previewData?: string; // base64 PNG preview
}

/**
 * Extracts Morphik-formatted results from MCP content
 * Format: [IMAGE_URL]url[/IMAGE_URL][TITLE]title[/TITLE][SCORE]score[/SCORE][DOC_URL]url[/DOC_URL][PREVIEW]data:image/png;base64,...[/PREVIEW]
 */
export function extractMorphikResults(content: any[]): MorphikResult[] {
  if (!Array.isArray(content)) {
    console.warn("[Morphik Parser] Content is not an array:", content);
    return [];
  }

  console.log(`[Morphik Parser] Processing ${content.length} content items`);

  const results: MorphikResult[] = [];

  content.forEach((item, index) => {
    console.log(
      `[Morphik Parser] Item ${index + 1}: type=${item?.type}, text length=${item?.text?.length || 0}`,
    );

    if (item?.type === "text" && typeof item?.text === "string") {
      const text = item.text;

      // Check if text contains Morphik tags
      const hasMorphikTags =
        text.includes("[IMAGE_URL]") && text.includes("[TITLE]");
      if (!hasMorphikTags) {
        console.log(
          `[Morphik Parser] Item ${index + 1} has no Morphik tags, skipping`,
        );
        return;
      }

      console.log(
        `[Morphik Parser] Item ${index + 1} text preview:`,
        text.substring(0, 200),
      );

      // Extract all tagged sections
      const imageUrlRegex = /\[IMAGE_URL\](.*?)(?:\[\/IMAGE_URL\])/gi;
      const titleRegex = /\[TITLE\](.*?)(?:\[\/TITLE\])/gi;
      const scoreRegex = /\[SCORE\]([\d.]+)(?:\[\/SCORE\])/gi;
      const docUrlRegex = /\[DOC_URL\](.*?)(?:\[\/DOC_URL\])/gi;
      // Match base64 data, allowing for whitespace and stopping at next tag or end
      const previewRegex =
        /\[PREVIEW\](data:image\/(?:png|jpeg|jpg);base64,[A-Za-z0-9+/=\s]+?)(?:\[\/PREVIEW\]|\[IMAGE_URL\]|$)/gi;

      const imageUrls = Array.from(text.matchAll(imageUrlRegex));
      const titles = Array.from(text.matchAll(titleRegex));
      const scores = Array.from(text.matchAll(scoreRegex));
      const docUrls = Array.from(text.matchAll(docUrlRegex));
      const previews = Array.from(text.matchAll(previewRegex));

      // Morphik sends multiple results in one text block
      // Match them up by index
      const count = imageUrls.length;
      console.log(
        `[Morphik Parser] Found ${count} results, ${previews.length} previews`,
      );

      for (let i = 0; i < count; i++) {
        // Clean the preview data by removing any whitespace from base64
        const rawPreview = previews[i]?.[1];
        const cleanedPreview = rawPreview
          ? rawPreview.replace(/\s+/g, "")
          : undefined;

        const imageUrl = imageUrls[i]?.[1]?.trim() || "";

        console.log(`[Morphik Parser] Result ${i + 1}:`);
        console.log(`  - IMAGE_URL: ${imageUrl.substring(0, 100)}...`);
        console.log(`  - Preview length: ${cleanedPreview?.length || 0} chars`);
        console.log(
          `  - Preview starts with: ${cleanedPreview?.substring(0, 50) || "none"}`,
        );

        results.push({
          imageUrl,
          title: titles[i]?.[1]?.trim(),
          score: parseFloat(scores[i]?.[1] || "0"),
          docUrl: docUrls[i]?.[1]?.trim(),
          previewData: cleanedPreview,
        });
      }
    }
  });

  return results;
}

/**
 * Converts Morphik results to MediaResource format
 * Shows preview thumbnails as main view (the relevant chunks)
 * Full PDF/document links available as secondary action
 */
export function morphikToMediaResources(
  morphikResults: MorphikResult[],
): MediaResource[] {
  const validResults = morphikResults.filter((result) => {
    // Must have an image URL to show
    return result.imageUrl;
  });

  console.log(
    `[Morphik Parser] Converting ${validResults.length} results to MediaResources`,
  );

  return validResults.map((result, index) => {
    // Check if the source is a PDF
    const isPdf = result.imageUrl.toLowerCase().includes(".pdf");

    // Use IMAGE_URL (the download URL) not PREVIEW (which is truncated to 200 chars)
    // If previewData looks complete (starts with data:image), use it as thumbnail
    const hasCompletePreview =
      result.previewData &&
      result.previewData.startsWith("data:image/") &&
      result.previewData.length > 1000;

    // Proxy external URLs through our backend to avoid CORS issues
    // Pre-signed S3 URLs need to be proxied
    const needsProxy = result.imageUrl.includes("amazonaws.com");
    const imageUrl = needsProxy
      ? `/api/proxy-image-morphik?url=${encodeURIComponent(result.imageUrl)}`
      : result.imageUrl;

    const mediaResource: MediaResource = {
      type: "image" as const,
      url: imageUrl, // Proxied URL to avoid CORS
      mimeType: "image/png",
      title: result.title || `Result ${index + 1}`,
      description: result.score
        ? `Relevance score: ${result.score.toFixed(2)}`
        : undefined,
      thumbnail: hasCompletePreview ? result.previewData : undefined,
      metadata: {
        score: result.score,
        isPdf: isPdf,
        fullDocumentUrl: result.docUrl,
        sourceUrl: result.imageUrl, // Keep original URL for reference
        // This will enable "View Full Document" button in the image viewer
        showFullDocumentLink: !!result.docUrl,
      },
    };

    console.log(`[Morphik Parser] Created MediaResource ${index + 1}:`, {
      type: mediaResource.type,
      proxied: needsProxy,
      hasThumbnail: !!mediaResource.thumbnail,
      thumbnailLength: mediaResource.thumbnail?.length || 0,
      urlPrefix: mediaResource.url.substring(0, 60),
    });

    return mediaResource;
  });
}

/**
 * Extracts clean text from Morphik content (text that appears after all Morphik blocks)
 */
export function cleanMorphikTags(text: string): string {
  console.log(
    "[Morphik cleanMorphikTags] Input text length:",
    text.length,
    "chars",
  );

  // Find the last occurrence of [PREVIEW] tag (end of last Morphik block)
  const lastPreviewIndex = text.lastIndexOf("[PREVIEW]");

  if (lastPreviewIndex === -1) {
    // No Morphik blocks found, return original text
    console.log("[Morphik cleanMorphikTags] No PREVIEW tags found");
    return text;
  }

  // Find where the last PREVIEW block ends (after the base64 data)
  // Look for text patterns that indicate summary content
  const afterPreview = text.substring(lastPreviewIndex);

  // Try multiple patterns to find summary text
  const patterns = [
    /\[Score:/i,
    /Retrieved \d+ chunk/i,
    /\nRetrieved/i,
    /\n\[Score/i,
    // Match any text after a reasonable amount of base64 chars (e.g., after 500 chars)
    /.{500,}?\n\w/,
  ];

  for (const pattern of patterns) {
    const match = afterPreview.match(pattern);
    if (match && match.index !== undefined) {
      const summaryStart = lastPreviewIndex + match.index;
      const extractedText = text.substring(summaryStart).trim();
      console.log(
        "[Morphik cleanMorphikTags] Found summary text:",
        extractedText.substring(0, 100),
      );
      return extractedText;
    }
  }

  console.log("[Morphik cleanMorphikTags] No summary text pattern matched");
  // No summary found, return empty string (images are shown separately)
  return "";
}

/**
 * Detects if content contains Morphik-formatted data
 */
export function isMorphikContent(content: any[]): boolean {
  if (!Array.isArray(content)) return false;

  return content.some((item) => {
    if (item?.type === "text" && typeof item?.text === "string") {
      const text = item.text;
      // Morphik content has multiple custom tags
      return (
        text.includes("[IMAGE_URL]") &&
        text.includes("[TITLE]") &&
        text.includes("[SCORE]")
      );
    }
    return false;
  });
}
