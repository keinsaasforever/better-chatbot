import "server-only";

/**
 * Community implementation of the browser credential store.
 *
 * This edition ships no secret manager, so stored credential values are never
 * available: runs can still load a saved sign-in session, but the agent gets
 * no username or password to type. The signatures match the hosted edition.
 */
export function isSecretManagerConfigured(): boolean {
  return false;
}

export function parseCredentialNote(_raw: string): Record<string, string> {
  return {};
}

export async function readSecretLatestVersion(
  _secretId: string,
): Promise<string> {
  throw new Error("No secret manager is configured in this edition.");
}
