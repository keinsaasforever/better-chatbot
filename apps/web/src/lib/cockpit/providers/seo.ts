import "server-only";

import type { SeoSummary } from "../types";
import {
  findArray,
  findNumber,
  McpServerMissingError,
  McpToolMissingError,
  type McpSession,
  type McpToolInfo,
  mcpReason,
  num,
  str,
  withMcpSession,
  withServerSession,
} from "./mcp";
import {
  SEO_DEFAULT_MCP_URL,
  type SeoConfig,
  seoConfigSchema,
} from "./schemas";
import {
  type CockpitProviderModule,
  inop,
  live,
  type ProviderContext,
} from "./types";

/**
 * SEO through an MCP server: OpenSEO or DataForSEO. OpenSEO only signs in
 * with OAuth, so it runs over an MCP server connected (and authorized) in
 * Navigator; DataForSEO can use Basic auth directly. Neither server's tool
 * list is pinned, so tools are matched by name pattern and their arguments
 * built from each tool's input schema. Results are read defensively (the
 * first matching field anywhere in the payload). Unverified against live
 * servers: a missing tool turns the feed INOP with its name.
 */

const TOOL_PATTERNS = {
  overview: [/domain_rank_overview/, /domain[_-]?overview/, /overview/],
  keywords: [
    /ranked_keywords/,
    /domain[_-]?keywords/,
    /keywords_for_site/,
    /ranked/,
  ],
  backlinks: [
    /backlinks_summary/,
    /backlink.*summary/,
    /referring_domains/,
    /backlinks?/,
  ],
};

/** Arguments for a domain-level tool, filled from whatever it declares. */
export function seoArgs(
  tool: McpToolInfo,
  config: Pick<SeoConfig, "domain" | "locationName" | "languageCode">,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...extra };
  for (const key of ["target", "domain", "site", "url", "website"]) {
    if (key in tool.properties) args[key] = config.domain;
  }
  const location = config.locationName || "United States";
  const language = config.languageCode || "en";
  if ("location_name" in tool.properties) args.location_name = location;
  if ("locationName" in tool.properties) args.locationName = location;
  if ("location" in tool.properties) args.location = location;
  if ("language_code" in tool.properties) args.language_code = language;
  if ("languageCode" in tool.properties) args.languageCode = language;
  if ("language" in tool.properties) args.language = language;
  return args;
}

/** Pure aggregation of the three tool results, exported for tests. */
export function summarizeSeo(input: {
  domain: string;
  overview: unknown;
  keywords: unknown;
  backlinks: unknown;
}): SeoSummary {
  const rows = findArray(
    input.keywords,
    (item) =>
      typeof item.keyword === "string" ||
      typeof (item.keyword_data as Record<string, unknown> | undefined)
        ?.keyword === "string",
  );
  const topKeywords = rows.slice(0, 10).map((item) => {
    const data = (item.keyword_data as Record<string, unknown>) ?? item;
    return {
      keyword: str(data.keyword) ?? str(item.keyword) ?? "",
      position:
        num(item.position) ??
        num(item.rank_absolute) ??
        findNumber(item.ranked_serp_element, ["rank_absolute", "rank_group"]),
      previousPosition:
        num(item.previous_position) ??
        num(item.previousPosition) ??
        findNumber(item, ["previous_rank_absolute", "previous_position"]),
      volume:
        num(item.search_volume) ??
        num(item.volume) ??
        findNumber(data, ["search_volume", "volume"]),
    };
  });

  return {
    domain: input.domain,
    organicTraffic: findNumber(input.overview, [
      "etv",
      "organic_traffic",
      "organicTraffic",
      "traffic",
    ]),
    keywordsCount:
      findNumber(input.overview, [
        "count",
        "keywords_count",
        "keywordsCount",
        "organic_keywords",
      ]) ?? findNumber(input.keywords, ["total_count", "totalCount"]),
    referringDomains: findNumber(input.backlinks, [
      "referring_domains",
      "referringDomains",
    ]),
    topKeywords: topKeywords.filter((k) => k.keyword),
  };
}

function session<T>(
  config: SeoConfig,
  ctx: ProviderContext,
  run: (s: McpSession) => Promise<T>,
) {
  if (config.mcpServerId) {
    return withServerSession(
      { mcpServerId: config.mcpServerId, scope: ctx.scope, signal: ctx.signal },
      run,
    );
  }
  // OpenSEO has no API key for its MCP server: it needs the OAuth session
  // of a connected Navigator MCP server.
  if (config.kind === "openseo") throw new McpServerMissingError();
  const basic = Buffer.from(`${config.login}:${config.password}`).toString(
    "base64",
  );
  return withMcpSession(
    {
      url: config.mcpUrl || SEO_DEFAULT_MCP_URL[config.kind],
      headers: { Authorization: `Basic ${basic}` },
      signal: ctx.signal,
      toolsCacheKey: ctx.connectionId
        ? `cockpit:mcp-tools:${ctx.connectionId}:${ctx.version ?? ""}`
        : undefined,
    },
    run,
  );
}

async function read(s: McpSession, config: SeoConfig): Promise<SeoSummary> {
  const overview = s.find(...TOOL_PATTERNS.overview);
  const keywords = s.find(...TOOL_PATTERNS.keywords);
  const backlinks = s.find(...TOOL_PATTERNS.backlinks);
  if (!overview && !keywords) throw new McpToolMissingError("domain overview");

  const [o, k, b] = await Promise.all([
    overview ? s.call(overview, seoArgs(overview, config)) : null,
    keywords
      ? s.call(
          keywords,
          seoArgs(keywords, config, {
            limit: 10,
            order_by: ["keyword_data.keyword_info.search_volume,desc"],
          }),
        )
      : null,
    // A backlinks subscription is often separate; its absence is not fatal.
    backlinks
      ? s.call(backlinks, seoArgs(backlinks, config)).catch(() => null)
      : null,
  ]);
  return summarizeSeo({
    domain: config.domain,
    overview: o,
    keywords: k,
    backlinks: b,
  });
}

export const seoProvider: CockpitProviderModule<SeoConfig, SeoSummary> = {
  provider: "seo",
  configSchema: seoConfigSchema,
  deadlineMs: 6000,

  async probe(config, ctx) {
    try {
      await session(config, ctx, async (s) => {
        if (!s.find(...TOOL_PATTERNS.overview, ...TOOL_PATTERNS.keywords))
          throw new McpToolMissingError("domain overview");
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: mcpReason(error) };
    }
  },

  async fetch(config, ctx) {
    try {
      return live(await session(config, ctx, (s) => read(s, config)));
    } catch (error) {
      return inop(mcpReason(error));
    }
  },
};
