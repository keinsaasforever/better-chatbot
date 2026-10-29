/**
 * Exa.ai API Key Rotation Module
 *
 * Since Exa.ai doesn't offer built-in API key rotation, we implement
 * client-side rotation to distribute load across multiple keys.
 *
 * Features:
 * - Round-robin rotation across multiple keys
 * - Automatic retry with next key on rate limits
 * - Simple configuration via environment variables
 */

// Load all Exa API keys from environment variables
// Supports both new format (EXA_API_KEY_1, EXA_API_KEY_2, ...)
// and legacy single key (EXA_API_KEY) for backward compatibility
const EXA_API_KEYS = [
  process.env.EXA_API_KEY_1,
  process.env.EXA_API_KEY_2,
  process.env.EXA_API_KEY_3,
  process.env.EXA_API_KEY_4,
  process.env.EXA_API_KEY_5,
  process.env.EXA_API_KEY, // Legacy single key fallback
].filter(Boolean) as string[];

let currentKeyIndex = 0;

/**
 * Get next Exa API key in rotation
 * Simple round-robin rotation across available keys
 */
export function getNextExaApiKey(): string {
  if (EXA_API_KEYS.length === 0) {
    throw new Error(
      "No EXA_API_KEY configured. Add EXA_API_KEY or EXA_API_KEY_1 to environment variables.",
    );
  }

  const key = EXA_API_KEYS[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % EXA_API_KEYS.length;

  return key;
}

/**
 * Get current number of configured Exa keys
 */
export function getExaKeyCount(): number {
  return EXA_API_KEYS.length;
}

/**
 * Retry with next key if rate limited
 * Automatically tries each available key until success or all exhausted
 */
export async function fetchExaWithRetry<T>(
  fetchFn: (apiKey: string) => Promise<T>,
  maxRetries: number = EXA_API_KEYS.length,
): Promise<T> {
  let lastError: Error | null = null;

  for (
    let attempt = 0;
    attempt < Math.min(maxRetries, EXA_API_KEYS.length);
    attempt++
  ) {
    try {
      const apiKey = getNextExaApiKey();
      return await fetchFn(apiKey);
    } catch (error: any) {
      lastError = error;

      // If rate limited (429) or quota exceeded, try next key
      if (
        error.message?.includes("429") ||
        error.message?.includes("rate limit") ||
        error.message?.includes("usage limit")
      ) {
        console.warn(
          `Exa API key ${attempt + 1}/${EXA_API_KEYS.length} rate limited, trying next key...`,
        );
        continue;
      }

      // For other errors (auth, network, etc.), throw immediately
      throw error;
    }
  }

  throw new Error(
    `All ${EXA_API_KEYS.length} Exa API keys exhausted. Last error: ${lastError?.message}`,
  );
}
