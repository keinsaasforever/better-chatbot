import "server-only";

import { createClient } from "@supabase/supabase-js";
import { type SiteEventRow, summarize } from "../marketing";
import { httpReason, reason } from "../reasons";
import type { MarketingSummary } from "../types";
import { toReason } from "./http";
import { type WebsiteConfig, websiteConfigSchema } from "./schemas";
import {
  type CockpitProviderModule,
  inop,
  live,
  type ProviderContext,
} from "./types";

/**
 * First-party website analytics: the marketing site's collector writes
 * `site_events` into its own Supabase project, and this provider reads them
 * with that project's secret key (RLS has no policies, so only the secret key
 * can read). Aggregation is the pure `summarize()`.
 */

// "*" rather than a column list, so a database that hasn't applied a newer
// migration still loads instead of failing on an unknown column.
const COLUMNS = "*";
const PAGE_SIZE = 1000;
// Safety valve for the in-memory aggregation; move to SQL rollups past this.
const MAX_ROWS = 50_000;

function client(config: WebsiteConfig, ctx: ProviderContext) {
  return createClient(config.supabaseUrl, config.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: ctx.signal }),
    },
  });
}

type QueryError = { code?: string } | null;

function queryReason(status: number, error: QueryError): string {
  if (status === 401 || status === 403) return httpReason(status);
  // Postgres / PostgREST codes only (e.g. 42P01 = table missing).
  return reason("queryFailed", error?.code ?? status);
}

export const websiteProvider: CockpitProviderModule<
  WebsiteConfig,
  MarketingSummary
> = {
  provider: "website",
  configSchema: websiteConfigSchema,
  deadlineMs: 4000,

  async probe(config, ctx) {
    try {
      const { error, status } = await client(config, ctx)
        .from("site_events")
        .select("id", { head: true, count: "exact" })
        .limit(1);
      return error
        ? { ok: false, reason: queryReason(status, error) }
        : { ok: true };
    } catch (error) {
      return { ok: false, reason: toReason(error) };
    }
  },

  async fetch(config, ctx) {
    const rangeDays = config.rangeDays;
    const since = new Date(
      Date.now() - 2 * rangeDays * 86_400_000,
    ).toISOString();
    const supabase = client(config, ctx);
    const rows: SiteEventRow[] = [];
    try {
      for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
        const { data, error, status } = await supabase
          .from("site_events")
          .select(COLUMNS)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (error) return inop(queryReason(status, error));
        rows.push(...((data ?? []) as unknown as SiteEventRow[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
    } catch (error) {
      return inop(toReason(error));
    }
    return live(summarize(rows, rangeDays));
  },
};
