import "server-only";

import en from "../../../messages/en.json";
import { CHANNEL_LABELS } from "./channels";
import { type CockpitScope, getCockpitData } from "./feeds";
import { financeSnapshot } from "./finance";
import { fromMinor } from "./format";
import { parseReason } from "./reasons";
import type {
  CockpitData,
  Feed,
  MarketingSummary,
  ProductHealth,
  SeoSummary,
  SuperlogSummary,
} from "./types";

/**
 * The cockpit as the `cockpit_*` Navigator tools report it (voice + MCP).
 *
 * Reads the same `getCockpitData(scope)` the page renders, so voice and UI
 * always agree, then folds it into four compact feeds. The realtime voice
 * model re-reads tool output on every turn, so lists are capped (at most
 * `MAX_ROWS`), breakdown tables are left out, and money is in major units.
 * INOP stays INOP, with its reason in plain English.
 */

export type { CockpitScope } from "./feeds";

const MAX_ROWS = 10;
const MAX_LATEST = 5;

const REASON_TEXT: Record<string, string> = en.Cockpit.reasons;

/** `"http|503"` → `"Provider error (HTTP 503)"`; unknown text passes through. */
export function reasonForTools(value: string): string {
  const { code, detail } = parseReason(value);
  if (!code) return value;
  const text = REASON_TEXT[code] ?? code;
  return text.replace("{detail}", detail);
}

const inop = (reason: string): { status: "inop"; reason: string } => ({
  status: "inop",
  reason: reasonForTools(reason),
});

/** One reason for a feed built from two sources that are both INOP. */
function combinedInop(
  a: [label: string, reason: string],
  b: [label: string, reason: string],
) {
  const [ra, rb] = [reasonForTools(a[1]), reasonForTools(b[1])];
  return {
    status: "inop" as const,
    reason: ra === rb ? ra : `${a[0]}: ${ra}; ${b[0]}: ${rb}`,
  };
}

const reasonOf = (feed: Feed<unknown>) =>
  feed.status === "inop" ? feed.reason : "";

const round = (n: number, digits = 0) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

/** Percent change, or null when there is no base to compare with. */
const pctChange = (now: number, before: number) =>
  before > 0 ? round(((now - before) / before) * 100) : null;

const latest = (...updatedAt: Array<string | undefined>) =>
  updatedAt.filter(Boolean).sort().at(-1) ?? new Date().toISOString();

// ── finance ─────────────────────────────────────────────────────────────

export function financeFeed(data: CockpitData) {
  const { stripe, revolut } = data;
  const snapshot = financeSnapshot(stripe, revolut);
  if (!snapshot) {
    return combinedInop(
      ["Stripe", reasonOf(stripe)],
      ["Revolut", reasonOf(revolut)],
    );
  }
  const s = stripe.status === "live" ? stripe.data : null;
  return {
    status: "live" as const,
    updatedAt: latest(
      stripe.status === "live" ? stripe.updatedAt : undefined,
      revolut.status === "live" ? revolut.updatedAt : undefined,
    ),
    data: {
      currency: snapshot.currency,
      mrr: snapshot.mrr === null ? null : round(snapshot.mrr),
      activeSubscriptions: s?.activeSubscriptions ?? null,
      /** Revolut + Stripe available balance in `currency`. */
      cash: snapshot.cash === null ? null : round(snapshot.cash),
      otherCash: snapshot.otherCash
        .slice(0, MAX_ROWS)
        .map((b) => ({ currency: b.currency, amount: round(b.amount) })),
      payments30d: snapshot.payments30d && {
        count: snapshot.payments30d.count,
        volume: round(snapshot.payments30d.volume),
      },
      inflow30d: snapshot.inflow30d === null ? null : round(snapshot.inflow30d),
      outflow30d:
        snapshot.outflow30d === null ? null : round(snapshot.outflow30d),
      burn: snapshot.burn === null ? null : round(snapshot.burn),
      runwayMonths: snapshot.runwayMonths,
      failedPayments7d: s
        ? {
            count: s.failed7d.length,
            latest: s.failed7d.slice(0, MAX_LATEST).map((c) => ({
              amount: fromMinor(c.amount, c.currency),
              currency: c.currency.toUpperCase(),
              created: c.created,
              description: c.description,
            })),
          }
        : null,
      nextPayout: snapshot.nextPayout,
      sources: {
        stripe:
          stripe.status === "live" ? "live" : reasonForTools(stripe.reason),
        revolut:
          revolut.status === "live" ? "live" : reasonForTools(revolut.reason),
      },
    },
  };
}

// ── marketing ───────────────────────────────────────────────────────────

/** Visits over the last 7 days against the 7 before, from the daily series. */
function weekOverWeek(daily: MarketingSummary["daily"]) {
  if (daily.length < 14) return null;
  const sum = (rows: MarketingSummary["daily"]) =>
    rows.reduce((n, d) => n + d.visits, 0);
  const last7 = sum(daily.slice(-7));
  const prior7 = sum(daily.slice(-14, -7));
  return {
    visitsLast7d: last7,
    visitsPrior7d: prior7,
    changePct: pctChange(last7, prior7),
  };
}

export function marketingFeed(data: CockpitData) {
  const feed = data.marketing;
  if (feed.status !== "live") return inop(feed.reason);
  const m = feed.data;
  return {
    status: "live" as const,
    updatedAt: feed.updatedAt,
    data: {
      rangeDays: m.rangeDays,
      visits: m.visits,
      visitors: m.visitors,
      pageviews: m.pageviews,
      leads: m.leads,
      bookingClicks: m.bookingClicks,
      conversionPct: round(m.conversionRate * 100, 1),
      vsPreviousPeriod: {
        visitsPct: pctChange(m.visits, m.previous.visits),
        leadsPct: pctChange(m.leads, m.previous.leads),
      },
      weekOverWeek: weekOverWeek(m.daily),
      topChannels: m.channels.slice(0, MAX_LATEST).map((c) => ({
        channel: CHANNEL_LABELS[c.channel] ?? c.channel,
        visits: c.visits,
        leads: c.leads,
      })),
      topPages: m.topPages.slice(0, MAX_LATEST),
      topCampaigns: m.topCampaigns.slice(0, MAX_LATEST),
      recentLeads: m.recentLeads.slice(0, MAX_LATEST).map((l) => ({
        at: l.at,
        channel: CHANNEL_LABELS[l.channel] ?? l.channel,
        source: l.source,
      })),
    },
  };
}

// ── product health ──────────────────────────────────────────────────────

function project(p: ProductHealth) {
  return {
    key: p.key,
    label: p.label,
    deploy:
      p.deploy.status === "live"
        ? {
            state: p.deploy.data.state,
            createdAt: p.deploy.data.createdAt,
            failedLast7d: p.deploy.data.failedLast7d,
          }
        : { inop: reasonForTools(p.deploy.reason) },
    incidents:
      p.incidents.status === "live"
        ? p.incidents.data
        : { inop: reasonForTools(p.incidents.reason) },
  };
}

function incidents(s: SuperlogSummary) {
  return {
    openIncidents: s.openIncidents,
    incidents24h: s.incidents24h,
    firingAlerts: s.firingAlerts,
    errors24h: s.errors24h,
    latest: s.incidents.slice(0, MAX_LATEST).map((i) => ({
      title: i.title,
      status: i.status,
      severity: i.severity,
      service: i.service,
      startedAt: i.startedAt,
    })),
  };
}

export function productHealthFeed(data: CockpitData) {
  const { products, superlog } = data;
  if (products.status !== "live" && superlog.status !== "live") {
    return combinedInop(
      ["Vercel", products.reason],
      ["Superlog", superlog.reason],
    );
  }
  return {
    status: "live" as const,
    updatedAt: latest(
      products.status === "live" ? products.updatedAt : undefined,
      superlog.status === "live" ? superlog.updatedAt : undefined,
    ),
    data: {
      deploys:
        products.status === "live"
          ? {
              total: products.data.length,
              projects: products.data.slice(0, MAX_ROWS).map(project),
              failing: products.data
                .filter(
                  (p) =>
                    p.deploy.status === "live" &&
                    p.deploy.data.state === "ERROR",
                )
                .map((p) => p.label),
            }
          : { inop: reasonForTools(products.reason) },
      incidents:
        superlog.status === "live"
          ? incidents(superlog.data)
          : { inop: reasonForTools(superlog.reason) },
    },
  };
}

// ── SEO ─────────────────────────────────────────────────────────────────

function keyword(k: SeoSummary["topKeywords"][number]) {
  return {
    keyword: k.keyword,
    position: k.position,
    /** Positive = moved up the results page. */
    change:
      k.position !== null && k.previousPosition !== null
        ? k.previousPosition - k.position
        : null,
    volume: k.volume,
  };
}

export function seoFeed(data: CockpitData) {
  const feed = data.seo;
  if (feed.status !== "live") return inop(feed.reason);
  const s = feed.data;
  return {
    status: "live" as const,
    updatedAt: feed.updatedAt,
    data: {
      domain: s.domain,
      organicTraffic: s.organicTraffic,
      keywordsCount: s.keywordsCount,
      referringDomains: s.referringDomains,
      topKeywords: s.topKeywords.slice(0, MAX_ROWS).map(keyword),
    },
  };
}

// ── summary ─────────────────────────────────────────────────────────────

export type CockpitToolData = {
  finance: ReturnType<typeof financeFeed>;
  marketing: ReturnType<typeof marketingFeed>;
  productHealth: ReturnType<typeof productHealthFeed>;
  seo: ReturnType<typeof seoFeed>;
};

export function toToolData(data: CockpitData): CockpitToolData {
  return {
    finance: financeFeed(data),
    marketing: marketingFeed(data),
    productHealth: productHealthFeed(data),
    seo: seoFeed(data),
  };
}

/**
 * The anomalies the copilot prompt asks to lead with, as short English
 * lines: failed deploys, open incidents, failed payments, a traffic drop of
 * more than 30 % week on week.
 */
export function attentionItems(view: CockpitToolData): string[] {
  const items: string[] = [];
  const { productHealth, finance, marketing } = view;
  if (productHealth.status === "live") {
    const { deploys, incidents: inc } = productHealth.data;
    const failing = "failing" in deploys ? (deploys.failing ?? []) : [];
    if (failing.length) items.push(`Deploy failing: ${failing.join(", ")}`);
    if ("openIncidents" in inc && inc.openIncidents > 0) {
      items.push(`${inc.openIncidents} open incident(s)`);
    }
  }
  if (finance.status === "live" && finance.data.failedPayments7d?.count) {
    items.push(
      `${finance.data.failedPayments7d.count} failed payment(s) in the last 7 days`,
    );
  }
  const wow = marketing.status === "live" ? marketing.data.weekOverWeek : null;
  if (
    wow?.changePct !== null &&
    wow?.changePct !== undefined &&
    wow.changePct <= -30
  ) {
    items.push(`Website visits down ${-wow.changePct} % week on week`);
  }
  return items.slice(0, MAX_ROWS);
}

/**
 * `cockpit_summary`'s cut: headline numbers only. The drill-in tools
 * (`cockpit_finance`, ...) carry the lists.
 */
export function summaryView(view: CockpitToolData) {
  const { finance, marketing, productHealth, seo } = view;
  return {
    finance:
      finance.status === "live"
        ? {
            ...finance,
            data: {
              ...finance.data,
              otherCash: undefined,
              failedPayments7d: finance.data.failedPayments7d
                ? { count: finance.data.failedPayments7d.count }
                : null,
            },
          }
        : finance,
    marketing:
      marketing.status === "live"
        ? {
            ...marketing,
            data: {
              ...marketing.data,
              topChannels: marketing.data.topChannels.slice(0, 3),
              topPages: undefined,
              topCampaigns: undefined,
              recentLeads: undefined,
            },
          }
        : marketing,
    productHealth:
      productHealth.status === "live"
        ? {
            ...productHealth,
            data: {
              deploys:
                "failing" in productHealth.data.deploys
                  ? {
                      projects: productHealth.data.deploys.total,
                      failing: productHealth.data.deploys.failing,
                    }
                  : productHealth.data.deploys,
              incidents:
                "openIncidents" in productHealth.data.incidents
                  ? { ...productHealth.data.incidents, latest: undefined }
                  : productHealth.data.incidents,
            },
          }
        : productHealth,
    seo:
      seo.status === "live"
        ? {
            ...seo,
            data: {
              ...seo.data,
              topKeywords: seo.data.topKeywords.slice(0, 3),
            },
          }
        : seo,
  };
}

/** The cockpit for a scope, folded for the `cockpit_*` tools. Never throws. */
export async function getCockpitToolData(
  scope: CockpitScope,
): Promise<CockpitToolData> {
  return toToolData(await getCockpitData(scope));
}
