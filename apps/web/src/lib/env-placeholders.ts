/**
 * Keys the Vercel deploy form asks for besides BETTER_AUTH_SECRET. The form
 * only has required fields, so the README's Deploy button pre-fills them with
 * a word: "required" for the AI Gateway key, "optional" for the rest. A field
 * left at its pre-filled word means "not set" and is removed before anything
 * reads it (without a gateway key, Vercel deployments fall back to OIDC).
 */
export const OPTIONAL_DEPLOY_KEYS = [
  "AI_GATEWAY_API_KEY",
  "COMPOSIO_API_KEY",
  "TENSORX_API_KEY",
  "ASSEMBLYAI_API_KEY",
] as const;

const PLACEHOLDERS = new Set(["required", "optional", "skip"]);

export function clearPlaceholderEnv(
  env: Record<string, string | undefined> = process.env,
) {
  for (const key of OPTIONAL_DEPLOY_KEYS) {
    const value = env[key]?.trim().toLowerCase();
    if (value && PLACEHOLDERS.has(value)) delete env[key];
  }
}
