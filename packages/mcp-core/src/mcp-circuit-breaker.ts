// No "server-only" here: this package must load in plain Node (vitest,
// future Electron main). The app-side shim re-adds the Next.js guard.
type BreakerLogger = { warn: (message: string) => void };

let logger: BreakerLogger = console;

/** Host apps inject their own logger; defaults to console. */
export const setMcpCircuitBreakerLogger = (l: BreakerLogger): void => {
  logger = l;
};

const readNum = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

// Open the circuit after this many consecutive connect/introspect failures.
// Default 3 so a single transient blip (slow cold start, brief network hiccup)
// no longer trips a server into a 60s skip; override with MCP_BREAKER_THRESHOLD.
const FAILURE_THRESHOLD = Math.max(
  1,
  readNum(process.env.MCP_BREAKER_THRESHOLD, 3),
);
// How long to skip a server once its circuit is open (ms).
const COOLDOWN_MS = readNum(process.env.MCP_BREAKER_COOLDOWN_MS, 60_000);

type BreakerState = { consecutiveFailures: number; openUntil: number };

/**
 * Per-instance circuit breaker for MCP servers.
 *
 * Problem: a single unreachable/slow MCP server makes the tool-loading path
 * (MCP page + every chat message) wait out the connect timeout, every time.
 * This breaker remembers which servers just failed and lets callers skip them
 * for a cooldown window, so one dead server stops stalling everything.
 *
 * Scope: in-process per serverless instance (no Redis wired up in this repo).
 * That's acceptable — a freshly cold instance pays at most one timeout per
 * server before the breaker opens; warm instances skip instantly. When Redis
 * is enabled this can be promoted to a shared store for cross-instance reuse.
 */
const breakers = new Map<string, BreakerState>();

/** True if the server should be skipped right now (recently failed). */
export const isMcpServerCircuitOpen = (serverId: string): boolean => {
  const state = breakers.get(serverId);
  if (!state) return false;
  if (state.openUntil > Date.now()) return true;
  // Cooldown elapsed — clear it so the next attempt is a fresh trial.
  if (state.openUntil !== 0) breakers.delete(serverId);
  return false;
};

/** Reset the breaker after a successful connection. */
export const recordMcpServerSuccess = (serverId: string): void => {
  if (breakers.has(serverId)) breakers.delete(serverId);
};

/** Record a failed connection; opens the circuit once the threshold is hit. */
export const recordMcpServerFailure = (
  serverId: string,
  serverName?: string,
): void => {
  const state = breakers.get(serverId) ?? {
    consecutiveFailures: 0,
    openUntil: 0,
  };
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
    state.openUntil = Date.now() + COOLDOWN_MS;
    logger.warn(
      `Circuit opened for "${serverName ?? serverId}" for ${COOLDOWN_MS}ms ` +
        `after ${state.consecutiveFailures} consecutive failure(s)`,
    );
  }
  breakers.set(serverId, state);
};
