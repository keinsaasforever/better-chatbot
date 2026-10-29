/**
 * Token route URL for the realtime voice session.
 *
 * Carries the agent id ONLY, and deliberately nothing else.
 *
 * This URL is also handed to the AI SDK's realtime transport, which POSTs it
 * with a body we do not control — so `agentId` has to travel in the query
 * string to reach the route on that path. Mentions used to ride along the same
 * way, and that was a latent 414: `buildVoiceToolMentions` emits one mention
 * per tool, each carrying the tool's full description, so a workspace with
 * ~80 selected tools produced tens of kilobytes of query string and the edge
 * rejected the request before it ever reached the route (no server log, which
 * is what made it hard to see).
 *
 * Mentions now travel in the POST body of the prepare call, which is the only
 * call that needs them — the transport's token call discards the context the
 * route builds and keeps just the token.
 */
export function buildVoiceTokenApiUrl(agentId?: string): string {
  const params = new URLSearchParams();
  if (agentId) {
    params.set("agentId", agentId);
  }
  const qs = params.toString();
  return `/api/chat/openai-realtime${qs ? `?${qs}` : ""}`;
}
