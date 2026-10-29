import "server-only";

import { createGateway } from "@ai-sdk/gateway";
import {
  getAiGatewayApiKey,
  getAiGatewayBaseUrl,
  getAiGatewayTeamIdOrSlug,
} from "lib/ai/speech/voice-realtime-config";

/**
 * Gateway client for minting realtime voice tokens server-side.
 * Uses the same env var fallbacks as register-gateway-provider.ts.
 */
export function getVoiceGateway() {
  const apiKey = getAiGatewayApiKey();
  const baseURL = getAiGatewayBaseUrl();

  const teamIdOrSlug = getAiGatewayTeamIdOrSlug();

  return createGateway({
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
    ...(teamIdOrSlug ? { teamIdOrSlug } : {}),
  });
}
