/**
 * Composio is optional: without a key, connected apps are simply unavailable.
 * Callers check this first instead of letting every request fail inside the
 * SDK. Kept apart from `client.ts` so the check does not load the SDK.
 */
export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim());
}
