import "server-only";
import { createGatewayProvider } from "@ai-sdk/gateway";

/**
 * Sanitizes environment variable values by trimming whitespace.
 * Returns undefined if the value is empty or null.
 */
const sanitize = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Detects AI Gateway configuration from environment variables.
 * Supports multiple naming conventions for flexibility.
 */
const baseURL = sanitize(
  process.env.AI_GATEWAY_URL ??
    process.env.AI_GATEWAY_BASE_URL ??
    process.env.VERCEL_AI_GATEWAY_URL ??
    process.env.VERCEL_AI_GATEWAY_BASE_URL ??
    process.env.VERCEL_AI_URL,
);

const apiKey = sanitize(
  process.env.AI_GATEWAY_API_KEY ??
    process.env.VERCEL_AI_GATEWAY_API_KEY ??
    process.env.VERCEL_AI_API_KEY ??
    process.env.VERCEL_AI_GATEWAY_TOKEN ??
    process.env.VERCEL_AI_TOKEN,
);

/**
 * Only configure AI Gateway if at least one environment variable is set, or
 * when deployed on Vercel: there the gateway authenticates with the
 * deployment's OIDC token, so no key is needed.
 * This allows fallback to direct provider usage when gateway is not configured.
 */
const shouldConfigureGateway = Boolean(
  baseURL || apiKey || process.env.VERCEL === "1",
);

if (shouldConfigureGateway) {
  // Create gateway provider instance with proper settings
  const provider = createGatewayProvider({
    ...(baseURL ? { baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
  });

  // Register as global default provider
  // This makes string model IDs automatically use the gateway
  const globalScope = globalThis as Record<string, unknown>;
  globalScope.AI_SDK_DEFAULT_PROVIDER = provider;

  // Log confirmation in development (helps with debugging)
  if (process.env.NODE_ENV === "development") {
    console.log("✅ AI Gateway provider registered globally");
    if (baseURL) console.log(`   Base URL: ${baseURL}`);
    console.log(`   API Key: ${apiKey ? "✓ Set" : "✗ Not set"}`);
  }
}

/**
 * Export the configured provider for inspection/testing.
 * Returns null if gateway is not configured.
 */
export const configuredGatewayProvider = shouldConfigureGateway
  ? ((globalThis as Record<string, unknown>).AI_SDK_DEFAULT_PROVIDER ?? null)
  : null;
