import type { MCPToolInfo } from "app-types/mcp";

/**
 * Per-warm-instance memo of each MCP server's introspected tool list.
 *
 * Listing tools means connect -> getToolInfo -> disconnect per enabled server,
 * which ran in the blocking pre-stream path on every chat request and added
 * 0.3-2s+ to TTFT. The tool list only changes when the server config changes,
 * so we cache it keyed by server id and versioned by the row's `updatedAt`: a
 * config save bumps `updatedAt`, which is loaded fresh from the DB every request
 * and produces a natural cache miss on every instance. That gives correct
 * invalidation across serverless instances without any explicit purge call.
 *
 * Mirrors the Composio tools memo in shared.chat.ts (in-process only; the tool
 * `execute` closures are rebuilt per request and connect lazily at call time).
 * Override the TTL with MCP_TOOLS_TTL_MS (default 5 min, matching Composio);
 * set to 0 to disable.
 */
const TTL_MS = (() => {
  const raw = Number(process.env.MCP_TOOLS_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5 * 60 * 1000;
})();

/**
 * How long a server that just failed to introspect stays skipped.
 *
 * Shorter than the success TTL: a dead server should come back on its own
 * within the minute, but not on the very next message. Override with
 * MCP_TOOLS_FAILURE_TTL_MS; 0 disables negative caching.
 */
const FAILURE_TTL_MS = (() => {
  const raw = Number(process.env.MCP_TOOLS_FAILURE_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 60 * 1000;
})();

type Entry = { version: string; toolInfo: MCPToolInfo[]; expiresAt: number };

// One entry per server id (Map.set overwrites stale versions), so memory is
// bounded to the number of distinct servers this instance has seen.
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<MCPToolInfo[]>>();

/** Non-blocking read: returns cached tool info only on a fresh, matching version. */
export function peekMcpToolInfo(
  serverId: string,
  version: string,
): MCPToolInfo[] | undefined {
  if (TTL_MS === 0) return undefined;
  const entry = cache.get(serverId);
  if (entry && entry.version === version && entry.expiresAt > Date.now()) {
    return entry.toolInfo;
  }
  return undefined;
}

/**
 * Return cached tool info or run `loader` (the connect+introspect) once,
 * caching the result and collapsing concurrent loads of the same version.
 * Only call after deciding the server is reachable — a rejected loader is not
 * cached, so a transient failure never poisons the entry.
 */
export function loadMcpToolInfoCached(
  serverId: string,
  version: string,
  loader: () => Promise<MCPToolInfo[]>,
): Promise<MCPToolInfo[]> {
  if (TTL_MS === 0) return loader();

  const cached = peekMcpToolInfo(serverId, version);
  if (cached) return Promise.resolve(cached);

  const flightKey = `${serverId}:${version}`;
  const existing = inflight.get(flightKey);
  if (existing) return existing;

  const promise = loader()
    .then((toolInfo) => {
      cache.set(serverId, {
        version,
        toolInfo,
        expiresAt: Date.now() + TTL_MS,
      });
      return toolInfo;
    })
    .finally(() => inflight.delete(flightKey));
  inflight.set(flightKey, promise);
  return promise;
}

/**
 * Record that a server could not be introspected, so the next request skips it
 * instead of paying the connect timeout again.
 *
 * A rejected loader is deliberately not cached above - a transient failure must
 * not poison a good entry - but the failures seen in production are not
 * transient. Four unreachable servers were costing every chat request the full
 * MCP_INTROSPECT_TIMEOUT (8s of a ~10s time-to-first-token), because the
 * circuit breaker needs three strikes and lives in a process that is usually
 * cold. Caching the failure as an empty tool list bounds that to one probe per
 * server per instance per minute, and every reader already treats an empty list
 * as "this server contributes no tools this turn".
 *
 * Call this only for genuine connectivity failures. An unauthorized server is
 * reachable and cheap, and the user may authorize it at any moment.
 */
export function rememberMcpToolLoadFailure(
  serverId: string,
  version: string,
): void {
  if (TTL_MS === 0 || FAILURE_TTL_MS === 0) return;
  cache.set(serverId, {
    version,
    toolInfo: [],
    expiresAt: Date.now() + FAILURE_TTL_MS,
  });
}
