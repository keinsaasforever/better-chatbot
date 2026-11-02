/**
 * Optional keys the Vercel deploy form asks for. The form only has required
 * fields, so the README's Deploy button pre-fills these with "skip"; that
 * value means "not set" and is removed before anything reads it.
 */
export const OPTIONAL_DEPLOY_KEYS = [
  "AI_GATEWAY_API_KEY",
  "COMPOSIO_API_KEY",
  "TENSORX_API_KEY",
] as const;

const PLACEHOLDER = "skip";

export function clearPlaceholderEnv(
  env: Record<string, string | undefined> = process.env,
) {
  for (const key of OPTIONAL_DEPLOY_KEYS) {
    if (env[key]?.trim().toLowerCase() === PLACEHOLDER) delete env[key];
  }
}
