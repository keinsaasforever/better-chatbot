import "server-only";

import { serverCache } from "lib/cache";
import { reason } from "../reasons";
import type { DeployState, DeployStatus, Feed, ProductHealth } from "../types";
import { fetchJson, toReason } from "./http";
import { type VercelConfig, vercelConfigSchema } from "./schemas";
import {
  type CockpitProviderModule,
  inop,
  live,
  type ProviderContext,
} from "./types";

/**
 * Production deployment state per configured Vercel project, for the ENGINES
 * display. Incidents come from Superlog and are merged in `feeds.ts`; spend
 * and margin stay INOP until a cost source exists.
 */

const KNOWN_STATES: readonly DeployState[] = [
  "READY",
  "ERROR",
  "BUILDING",
  "QUEUED",
  "CANCELED",
  "INITIALIZING",
];

type VercelDeployment = {
  uid: string;
  url?: string;
  created: number;
  state?: string;
  readyState?: string;
};

/** The account a request runs under; empty means the token's own scope. */
type TeamScope = { teamId?: string; slug?: string };

const TEAM_SCOPE_TTL_MS = 60 * 60_000;

function withScope(params: URLSearchParams, scope: TeamScope) {
  if (scope.teamId) params.set("teamId", scope.teamId);
  else if (scope.slug) params.set("slug", scope.slug);
  return params;
}

/**
 * Finds the account that owns the first project: the token's own scope or
 * one of its teams. Vercel keeps Hobby projects in a default team ("<name>'s
 * projects"), so a blank team field made every request miss the project.
 * Null when no candidate owns it (or the lookups failed).
 */
async function discoverScope(
  config: VercelConfig,
  ctx: ProviderContext,
): Promise<TeamScope | null> {
  const init = {
    headers: { Authorization: `Bearer ${config.token}` },
    signal: ctx.signal,
  };
  const project = encodeURIComponent(config.projects[0].projectId);
  // Project-scoped tokens cannot list teams; they infer their own scope.
  const { teams = [] } = await fetchJson<{ teams?: Array<{ id?: unknown }> }>(
    "https://api.vercel.com/v2/teams?limit=20",
    init,
  ).catch(() => ({ teams: [] }));
  const candidates: TeamScope[] = [
    {},
    ...teams
      .map((t) => t.id)
      .filter((id): id is string => typeof id === "string")
      .map((teamId) => ({ teamId })),
  ];
  const owns = await Promise.all(
    candidates.map((scope) =>
      fetchJson(
        `https://api.vercel.com/v9/projects/${project}?${withScope(new URLSearchParams(), scope)}`,
        init,
      ).then(
        () => true,
        () => false,
      ),
    ),
  );
  return candidates[owns.indexOf(true)] ?? null;
}

/** Team from the config (id or slug), else discovered and cached. */
async function teamScope(
  config: VercelConfig,
  ctx: ProviderContext,
): Promise<TeamScope> {
  const team = config.teamId?.trim();
  if (team) return team.startsWith("team_") ? { teamId: team } : { slug: team };
  const key = ctx.connectionId
    ? `cockpit:vercel-team:${ctx.connectionId}:${ctx.version ?? ""}`
    : null;
  const cached = key ? await serverCache.get<TeamScope>(key) : undefined;
  if (cached) return cached;
  const found = await discoverScope(config, ctx);
  // Only a hit is cached: a failed lookup is retried on the next refresh.
  if (found && key) await serverCache.set(key, found, TEAM_SCOPE_TTL_MS);
  return found ?? {};
}

async function deployments(
  config: VercelConfig,
  scope: TeamScope,
  projectId: string,
  limit: number,
  ctx: ProviderContext,
): Promise<VercelDeployment[]> {
  const params = withScope(
    new URLSearchParams({
      projectId,
      target: "production",
      limit: String(limit),
    }),
    scope,
  );
  const { deployments = [] } = await fetchJson<{
    deployments?: VercelDeployment[];
  }>(`https://api.vercel.com/v6/deployments?${params}`, {
    headers: { Authorization: `Bearer ${config.token}` },
    signal: ctx.signal,
  });
  return deployments;
}

/** Pure mapping of a deployments page to the deploy readout. */
export function deployStatus(
  list: VercelDeployment[],
  now = Date.now(),
): Feed<DeployStatus> {
  const latest = list[0];
  if (!latest) return inop(reason("noDeployments"));
  const weekAgo = now - 7 * 86_400_000;
  const raw = (latest.state ?? latest.readyState ?? "").toUpperCase();
  return live({
    id: latest.uid,
    state: KNOWN_STATES.includes(raw as DeployState)
      ? (raw as DeployState)
      : "UNKNOWN",
    createdAt: new Date(latest.created).toISOString(),
    url: latest.url ? `https://${latest.url}` : null,
    failedLast7d: list.filter(
      (d) => d.created >= weekAgo && (d.state ?? d.readyState) === "ERROR",
    ).length,
  });
}

export const vercelProvider: CockpitProviderModule<
  VercelConfig,
  ProductHealth[]
> = {
  provider: "vercel",
  configSchema: vercelConfigSchema,
  deadlineMs: 4000,

  async probe(config, ctx) {
    try {
      const scope = await teamScope(config, ctx);
      await deployments(config, scope, config.projects[0].projectId, 1, ctx);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: toReason(error) };
    }
  },

  async fetch(config, ctx) {
    const scope = await teamScope(config, ctx);
    const results = await Promise.all(
      config.projects.map(async (project): Promise<ProductHealth> => {
        let deploy: Feed<DeployStatus>;
        try {
          deploy = deployStatus(
            await deployments(config, scope, project.projectId, 20, ctx),
          );
        } catch (error) {
          deploy = inop(toReason(error));
        }
        return {
          key: project.key,
          label: project.label,
          deploy,
          incidents: inop(reason("notConnected")),
          spend: inop(reason("spendSource")),
          margin: inop(reason("marginSource")),
        };
      }),
    );
    // One unreachable project leaves the others readable; only a total
    // failure turns the whole display INOP.
    const failed = results.every((p) => p.deploy.status === "inop");
    if (failed && results[0]?.deploy.status === "inop") {
      const first = results[0].deploy;
      if (first.reason !== reason("noDeployments")) return inop(first.reason);
    }
    return live(results);
  },
};
