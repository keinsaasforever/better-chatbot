import { type Channel, isChannel } from "./channels";
import {
  BREAKDOWN_KEYS,
  type BreakdownKey,
  type BreakdownRow,
  type ChannelRow,
  type MarketingSummary,
} from "./types";

/**
 * One row of the marketing site's `site_events` table (see
 * marketing-website `supabase/migrations/20261001_create_site_events.sql`).
 */
export interface SiteEventRow {
  created_at: string;
  kind: "pageview" | "event";
  name: string | null;
  path: string;
  is_landing: boolean;
  channel: string;
  source: string;
  utm_campaign: string | null;
  visitor_hash: string;
  props: Record<string, unknown> | null;
  // Optional: older rows / databases without the later migrations.
  host?: string | null;
  referrer_host?: string | null;
  utm_term?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  device?: string | null;
  browser?: string | null;
  os?: string | null;
}

const BREAKDOWN_LIMIT = 20;
const UNKNOWN = "(unknown)";

/** Value of a breakdown dimension for one row, or null when not applicable. */
function dimension(row: SiteEventRow, key: BreakdownKey): string | null {
  switch (key) {
    case "channel":
      return asChannel(row.channel);
    case "referrer":
      return row.referrer_host || "(direct)";
    case "campaign":
      return row.utm_campaign || null;
    case "keyword":
      return row.utm_term || null;
    case "country":
      return row.country || UNKNOWN;
    case "region":
      return row.region
        ? `${row.country ? `${row.country}-` : ""}${row.region}`
        : UNKNOWN;
    case "city":
      return row.city || UNKNOWN;
    case "page":
    case "entry":
      return row.path;
    case "hostname":
      return row.host || UNKNOWN;
    case "browser":
      return row.browser || UNKNOWN;
    case "os":
      return row.os || UNKNOWN;
    case "device":
      return row.device || UNKNOWN;
  }
}

// Page counts every pageview; every other dimension counts visits (landing
// pageviews). Leads are attributed by the lead event's own dimension values,
// which carry the visit's channel/source/campaign; page-based dimensions
// get no lead counts because the event fires on the form page, not the entry.
const LEADLESS: ReadonlySet<BreakdownKey> = new Set([
  "page",
  "entry",
  "hostname",
]);

function buildBreakdowns(
  rows: SiteEventRow[],
): Record<BreakdownKey, BreakdownRow[]> {
  const maps = Object.fromEntries(
    BREAKDOWN_KEYS.map((k) => [k, new Map<string, BreakdownRow>()]),
  ) as Record<BreakdownKey, Map<string, BreakdownRow>>;
  const bump = (
    key: BreakdownKey,
    value: string | null,
    field: "visits" | "leads",
  ) => {
    if (!value) return;
    const map = maps[key];
    const row = map.get(value) ?? { key: value, visits: 0, leads: 0 };
    row[field]++;
    map.set(value, row);
  };

  for (const row of rows) {
    const isVisit = row.kind === "pageview" && row.is_landing;
    const isLead = row.kind === "event" && row.name === "lead";
    if (row.kind === "pageview") bump("page", dimension(row, "page"), "visits");
    for (const key of BREAKDOWN_KEYS) {
      if (key === "page") continue;
      if (isVisit) bump(key, dimension(row, key), "visits");
      if (isLead && !LEADLESS.has(key)) bump(key, dimension(row, key), "leads");
    }
  }

  return Object.fromEntries(
    BREAKDOWN_KEYS.map((k) => [
      k,
      [...maps[k].values()]
        .sort((a, b) => b.visits - a.visits || b.leads - a.leads)
        .slice(0, BREAKDOWN_LIMIT),
    ]),
  ) as Record<BreakdownKey, BreakdownRow[]>;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function asChannel(value: string): Channel {
  return isChannel(value) ? value : "referral";
}

/**
 * Pure aggregation over raw `site_events` rows. `rows` must cover the current
 * period and the previous one (2 × rangeDays) so trends can be computed.
 */
export function summarize(
  rows: SiteEventRow[],
  rangeDays: number,
  now = new Date(),
): MarketingSummary {
  const end = now.getTime();
  const start = end - rangeDays * 86_400_000;
  const prevStart = start - rangeDays * 86_400_000;

  const channels = new Map<
    Channel,
    { visits: number; visitors: Set<string>; leads: number }
  >();
  const pages = new Map<string, number>();
  const campaigns = new Map<string, { visits: number; leads: number }>();
  const daily = new Map<string, { visits: number; leads: number }>();
  const visitorDays = new Set<string>();
  const recentLeads: MarketingSummary["recentLeads"] = [];

  let visits = 0;
  let pageviews = 0;
  let leads = 0;
  let bookingClicks = 0;
  let prevVisits = 0;
  let prevLeads = 0;
  const current: SiteEventRow[] = [];

  for (let i = 0; i < rangeDays; i++) {
    const d = new Date(end - (rangeDays - 1 - i) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    daily.set(d, { visits: 0, leads: 0 });
  }

  for (const row of rows) {
    const t = Date.parse(row.created_at);
    if (Number.isNaN(t) || t < prevStart || t > end) continue;
    const isLead = row.kind === "event" && row.name === "lead";
    const isVisit = row.kind === "pageview" && row.is_landing;

    if (t < start) {
      if (isVisit) prevVisits++;
      if (isLead) prevLeads++;
      continue;
    }

    current.push(row);
    const channel = asChannel(row.channel);
    const bucket = channels.get(channel) ?? {
      visits: 0,
      visitors: new Set<string>(),
      leads: 0,
    };
    channels.set(channel, bucket);
    const day = daily.get(dayKey(row.created_at));

    if (row.kind === "pageview") {
      pageviews++;
      pages.set(row.path, (pages.get(row.path) ?? 0) + 1);
      // Hashes rotate daily, so a "visitor" is unique per day; summing
      // daily uniques is the honest number this privacy model allows.
      visitorDays.add(`${dayKey(row.created_at)}|${row.visitor_hash}`);
      bucket.visitors.add(`${dayKey(row.created_at)}|${row.visitor_hash}`);
    }
    if (isVisit) {
      visits++;
      bucket.visits++;
      if (day) day.visits++;
      if (row.utm_campaign) {
        const c = campaigns.get(row.utm_campaign) ?? { visits: 0, leads: 0 };
        c.visits++;
        campaigns.set(row.utm_campaign, c);
      }
    }
    if (isLead) {
      leads++;
      bucket.leads++;
      if (day) day.leads++;
      if (row.utm_campaign) {
        const c = campaigns.get(row.utm_campaign) ?? { visits: 0, leads: 0 };
        c.leads++;
        campaigns.set(row.utm_campaign, c);
      }
      const form =
        row.props && typeof row.props.form === "string" ? row.props.form : null;
      recentLeads.push({
        at: row.created_at,
        channel,
        source: row.source,
        form,
      });
    }
    if (row.kind === "event" && row.name === "booking_cta_click")
      bookingClicks++;
  }

  const channelRows: ChannelRow[] = [...channels.entries()]
    .map(([channel, b]) => ({
      channel,
      visits: b.visits,
      visitors: b.visitors.size,
      leads: b.leads,
    }))
    .filter((r) => r.visits > 0 || r.leads > 0)
    .sort((a, b) => b.visits - a.visits || b.leads - a.leads);

  return {
    rangeDays,
    visits,
    visitors: visitorDays.size,
    pageviews,
    leads,
    bookingClicks,
    conversionRate: visits > 0 ? leads / visits : 0,
    previous: { visits: prevVisits, leads: prevLeads },
    channels: channelRows,
    topPages: [...pages.entries()]
      .map(([path, n]) => ({ path, pageviews: n }))
      .sort((a, b) => b.pageviews - a.pageviews)
      .slice(0, 8),
    topCampaigns: [...campaigns.entries()]
      .map(([campaign, c]) => ({ campaign, ...c }))
      .sort((a, b) => b.leads - a.leads || b.visits - a.visits)
      .slice(0, 6),
    daily: [...daily.entries()].map(([d, v]) => ({ day: d, ...v })),
    recentLeads: recentLeads
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8),
    breakdowns: buildBreakdowns(current),
  };
}
