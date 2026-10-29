/**
 * HLS URL resolution utilities for Twelve Labs video integration
 * Handles fetching streaming URLs from your Flask endpoint
 */

export interface HLSUrlResponse {
  video_url: string;
  analysis?: string;
}

export interface HLSUrlError {
  error: string;
  details?: string;
}

/**
 * Resolves a video_id to an HLS streaming URL using your Flask endpoint
 *
 * @param videoId - The video ID from Twelve Labs workflow response
 * @param baseUrl - Base URL of your Flask endpoint (optional, defaults to relative path)
 * @returns Promise<string> - The HLS streaming URL
 * @throws Error if the request fails or video is not found
 */
export async function resolveHLSUrl(
  videoId: string,
  baseUrl: string = "",
): Promise<string> {
  try {
    // Construct the endpoint URL
    // Assuming your Flask endpoint is: GET /analyze/${video_id}
    const endpoint = baseUrl
      ? `${baseUrl}/analyze/${videoId}`
      : `/analyze/${videoId}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: HLSUrlResponse | HLSUrlError = await response.json();

    // Check if the response contains an error
    if ("error" in data) {
      throw new Error(
        `Flask endpoint error: ${data.error}${data.details ? ` - ${data.details}` : ""}`,
      );
    }

    // Extract the HLS URL from the response
    if (!data.video_url) {
      throw new Error("No video_url found in response");
    }

    return data.video_url;
  } catch (error) {
    // Re-throw with more context
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    throw new Error(
      `Failed to resolve HLS URL for video ${videoId}: ${errorMessage}`,
    );
  }
}

/**
 * Resolves multiple video IDs to HLS URLs concurrently
 * Useful for batch processing multiple video clips
 *
 * @param videoIds - Array of video IDs to resolve
 * @param baseUrl - Base URL of your Flask endpoint (optional)
 * @returns Promise<Map<string, string | Error>> - Map of videoId to HLS URL or error
 */
export async function resolveMultipleHLSUrls(
  videoIds: string[],
  baseUrl: string = "",
): Promise<Map<string, string | Error>> {
  const results = new Map<string, string | Error>();

  // Process all requests concurrently
  const promises = videoIds.map(async (videoId) => {
    try {
      const hlsUrl = await resolveHLSUrl(videoId, baseUrl);
      results.set(videoId, hlsUrl);
    } catch (error) {
      results.set(
        videoId,
        error instanceof Error ? error : new Error("Unknown error"),
      );
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Cache for HLS URLs to avoid repeated API calls
 * Simple in-memory cache with TTL
 */
class HLSUrlCache {
  private cache = new Map<string, { url: string; timestamp: number }>();
  private readonly TTL = 60 * 60 * 1000; // 1 hour TTL

  set(videoId: string, url: string): void {
    this.cache.set(videoId, { url, timestamp: Date.now() });
  }

  get(videoId: string): string | null {
    const entry = this.cache.get(videoId);
    if (!entry) return null;

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.TTL) {
      this.cache.delete(videoId);
      return null;
    }

    return entry.url;
  }

  clear(): void {
    this.cache.clear();
  }
}

// Global cache instance
const hlsUrlCache = new HLSUrlCache();

/**
 * Cached version of resolveHLSUrl that stores results in memory
 *
 * @param videoId - The video ID from Twelve Labs workflow response
 * @param baseUrl - Base URL of your Flask endpoint (optional)
 * @returns Promise<string> - The HLS streaming URL
 */
export async function resolveHLSUrlCached(
  videoId: string,
  baseUrl: string = "",
): Promise<string> {
  // Check cache first
  const cachedUrl = hlsUrlCache.get(videoId);
  if (cachedUrl) {
    return cachedUrl;
  }

  // Fetch from API
  const hlsUrl = await resolveHLSUrl(videoId, baseUrl);

  // Cache the result
  hlsUrlCache.set(videoId, hlsUrl);

  return hlsUrl;
}

/**
 * Utility to clear the HLS URL cache
 * Useful for testing or when you need fresh data
 */
export function clearHLSUrlCache(): void {
  hlsUrlCache.clear();
}
