import "server-only";
import { Agentset } from "agentset";

let cached: Agentset | null = null;

export function getAgentsetClient() {
  if (!process.env.AGENTSET_API_KEY) {
    throw new Error("AGENTSET_API_KEY is not configured");
  }

  cached ??= new Agentset({ apiKey: process.env.AGENTSET_API_KEY });
  return cached;
}

export function getAgentsetNamespace(namespaceId: string) {
  return getAgentsetClient().namespace(namespaceId);
}
