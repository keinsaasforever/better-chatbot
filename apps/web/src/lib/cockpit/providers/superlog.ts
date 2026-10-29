import "server-only";

import { reason } from "../reasons";
import type { SuperlogSummary } from "../types";
import {
  asArray,
  McpToolMissingError,
  type McpSession,
  mcpReason,
  num,
  str,
  withMcpSession,
} from "./mcp";
import { type SuperlogConfig, superlogConfigSchema } from "./schemas";
import {
  type CockpitProviderModule,
  inop,
  live,
  type ProviderContext,
} from "./types";

/**
 * Superlog (observability) through its MCP server. Tool names were verified
 * against the hosted connector (search_incidents, list_alerts, query_logs);
 * argument shapes are read from `tools/list` at runtime and only declared
 * arguments are sent. `search_incidents` is required; a missing alerts or
 * logs tool leaves that number empty instead of failing the feed.
 */

const ERROR_LOG_LIMIT = 500;

/**
 * The MCP server only accepts a personal access token (superlog_pat_…,
 * Settings → MCP tokens) or an OAuth access token. The ingest key and the
 * org management key are valid keys that it answers with a 401, which reads
 * as "wrong key" and hides that a different kind of key is needed.
 */
const NON_MCP_KEY = /^(sl_public_|superlog_live_|sl_management_)/;
const wrongKey = () => reason("wrongKey", "superlog_pat_…");

type Incident = SuperlogSummary["incidents"][number] & {
  firstSeen: string | null;
};

function toIncident(raw: unknown): Incident | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id);
  if (!id) return null;
  return {
    id,
    title: (str(r.title) ?? str(r.codename) ?? id).slice(0, 160),
    status: str(r.status) ?? "unknown",
    severity: str(r.severity),
    service: str(r.service),
    startedAt: str(r.firstSeen) ?? str(r.first_seen) ?? null,
    firstSeen: str(r.firstSeen) ?? str(r.first_seen) ?? null,
  };
}

const FIRING = /firing|alerting|triggered|active/i;

function isFiring(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>;
  const state =
    str(r.state) ?? str(r.status) ?? str(r.lastState) ?? str(r.last_state);
  return state ? FIRING.test(state) && !/inactive/i.test(state) : false;
}

/** Pure aggregation of the three tool results, exported for tests. */
export function summarizeSuperlog(input: {
  open: unknown;
  recent: unknown;
  alerts: unknown;
  errors: unknown;
  now: number;
}): SuperlogSummary {
  const open = asArray(input.open, "incidents", "items", "results")
    .map(toIncident)
    .filter((i): i is Incident => !!i && i.status === "open");
  const since = input.now - 86_400_000;
  const recent = asArray(input.recent, "incidents", "items", "results")
    .map(toIncident)
    .filter(
      (i): i is Incident =>
        !!i && !!i.firstSeen && Date.parse(i.firstSeen) >= since,
    );
  const errorRows =
    input.errors === null
      ? null
      : asArray(input.errors, "rows", "logs", "items");

  const services = new Map<
    string,
    { openIncidents: number; errors24h: number }
  >();
  const bump = (name: string | null, field: "openIncidents" | "errors24h") => {
    if (!name) return;
    const s = services.get(name) ?? { openIncidents: 0, errors24h: 0 };
    s[field]++;
    services.set(name, s);
  };
  for (const i of open) bump(i.service, "openIncidents");
  for (const row of errorRows ?? []) {
    const r = row as Record<string, unknown>;
    bump(str(r.service) ?? str(r.service_name), "errors24h");
  }

  const openCount = num((input.open as { count?: unknown })?.count);
  return {
    openIncidents: Math.max(open.length, openCount ?? 0),
    incidents24h: recent.length,
    firingAlerts:
      input.alerts === null
        ? 0
        : asArray(input.alerts, "alerts", "items").filter(isFiring).length,
    errors24h: errorRows ? errorRows.length : null,
    incidents: open
      .slice(0, 20)
      .map(({ firstSeen: _f, ...incident }) => incident),
    services: [...services.entries()]
      .map(([name, s]) => ({ name, ...s }))
      .sort(
        (a, b) =>
          b.openIncidents - a.openIncidents || b.errors24h - a.errors24h,
      ),
  };
}

async function read(session: McpSession, now: number) {
  const search = session.find("search_incidents", /incident/);
  if (!search) throw new McpToolMissingError("search_incidents");
  const alertsTool = session.find("list_alerts", /alert/);
  const logsTool = session.find("query_logs", /logs?$/);
  const since = new Date(now - 86_400_000).toISOString();

  const [open, recent, alerts, errors] = await Promise.all([
    session.call(search, { status: "open", limit: 100 }),
    session.call(search, { status: "all", since, limit: 200 }),
    alertsTool ? session.call(alertsTool, {}) : Promise.resolve(null),
    logsTool
      ? session.call(logsTool, {
          severity: "ERROR",
          range: { since: "now() - INTERVAL 24 HOUR" },
          limit: ERROR_LOG_LIMIT,
        })
      : Promise.resolve(null),
  ]);
  return summarizeSuperlog({ open, recent, alerts, errors, now });
}

function session<T>(
  config: SuperlogConfig,
  ctx: ProviderContext,
  run: (s: McpSession) => Promise<T>,
) {
  return withMcpSession(
    {
      url: config.mcpUrl,
      headers: { Authorization: `Bearer ${config.token}` },
      signal: ctx.signal,
      toolsCacheKey: ctx.connectionId
        ? `cockpit:mcp-tools:${ctx.connectionId}:${ctx.version ?? ""}`
        : undefined,
    },
    run,
  );
}

export const superlogProvider: CockpitProviderModule<
  SuperlogConfig,
  SuperlogSummary
> = {
  provider: "superlog",
  configSchema: superlogConfigSchema,
  // MCP needs initialize + tools/list + calls; more than a single REST GET.
  deadlineMs: 6000,

  async probe(config, ctx) {
    if (NON_MCP_KEY.test(config.token))
      return { ok: false, reason: wrongKey() };
    try {
      await session(config, ctx, async (s) => {
        if (!s.find("search_incidents", /incident/))
          throw new McpToolMissingError("search_incidents");
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: mcpReason(error) };
    }
  },

  async fetch(config, ctx) {
    if (NON_MCP_KEY.test(config.token)) return inop(wrongKey());
    try {
      return live(await session(config, ctx, (s) => read(s, Date.now())));
    } catch (error) {
      return inop(mcpReason(error));
    }
  },
};
