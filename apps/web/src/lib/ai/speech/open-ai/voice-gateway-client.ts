import { VOICE_REALTIME_MODEL } from "lib/ai/speech/voice-realtime-config";
import { getGatewayRealtimeWebSocketProtocols } from "./voice-constants";

/** Set before WebSocket connect (from token route response). */
let browserGatewayTeamIdOrSlug: string | undefined;

export function setBrowserGatewayTeamIdOrSlug(teamIdOrSlug?: string) {
  browserGatewayTeamIdOrSlug = teamIdOrSlug?.trim() || undefined;
}

/**
 * Browser-safe stand-in for `gateway.experimental_realtime(modelId)`.
 *
 * @ai-sdk/gateway@canary.107 throws if `gateway.experimental_realtime()` is
 * called in the browser. This mirrors `GatewayRealtimeModel` from that package
 * (getWebSocketConfig / parseServerEvent / serializeClientEvent).
 *
 * @see https://vercel.com/docs/ai-gateway/getting-started/realtime
 */
export function createBrowserGatewayRealtimeModel() {
  return {
    modelId: VOICE_REALTIME_MODEL,
    getWebSocketConfig({
      token,
      url,
    }: {
      token: string;
      url: string;
    }) {
      return {
        url,
        protocols: getGatewayRealtimeWebSocketProtocols(token, {
          teamIdOrSlug: browserGatewayTeamIdOrSlug,
        }),
      };
    },
    parseServerEvent(raw: unknown) {
      return raw;
    },
    serializeClientEvent(event: unknown) {
      return event;
    },
  };
}
