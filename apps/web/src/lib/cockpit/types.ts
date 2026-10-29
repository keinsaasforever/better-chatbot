import type { Channel } from "./channels";

/** Every instrument is either live or explicitly INOP (no data source yet). */
export type Feed<T> =
  | { status: "live"; data: T; updatedAt: string }
  | { status: "inop"; reason: string };

export interface ChannelRow {
  channel: Channel;
  visits: number;
  visitors: number;
  leads: number;
}

export const BREAKDOWN_KEYS = [
  "channel",
  "referrer",
  "campaign",
  "keyword",
  "country",
  "region",
  "city",
  "page",
  "entry",
  "hostname",
  "browser",
  "os",
  "device",
] as const;

export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];

/** One row of a DataFast-style breakdown. `visits` is pageviews for "page". */
export interface BreakdownRow {
  key: string;
  visits: number;
  leads: number;
}

export interface MarketingSummary {
  rangeDays: number;
  visits: number;
  visitors: number;
  pageviews: number;
  leads: number;
  bookingClicks: number;
  /** leads / visits, 0..1 */
  conversionRate: number;
  /** Same metrics for the previous period of equal length, for trend arrows. */
  previous: { visits: number; leads: number };
  channels: ChannelRow[];
  topPages: Array<{ path: string; pageviews: number }>;
  topCampaigns: Array<{ campaign: string; visits: number; leads: number }>;
  daily: Array<{ day: string; visits: number; leads: number }>;
  recentLeads: Array<{
    at: string;
    channel: Channel;
    source: string;
    form: string | null;
  }>;
  breakdowns: Record<BreakdownKey, BreakdownRow[]>;
}

export type DeployState =
  | "READY"
  | "ERROR"
  | "BUILDING"
  | "QUEUED"
  | "CANCELED"
  | "INITIALIZING"
  | "UNKNOWN";

export interface DeployStatus {
  /** Vercel deployment uid, used as the alert dedupe key. */
  id: string;
  state: DeployState;
  createdAt: string;
  url: string | null;
  failedLast7d: number;
}

export interface ProductHealth {
  /** Connection-defined key, e.g. "navigator". */
  key: string;
  /** Connection-defined display name, e.g. "NAVIGATOR". */
  label: string;
  deploy: Feed<DeployStatus>;
  incidents: Feed<{ open: number; errors24h: number }>;
  spend: Feed<{ monthToDateEur: number }>;
  margin: Feed<{ grossMarginPct: number }>;
}

/** Amounts are minor units (cents) in `currency`, as Stripe reports them. */
export interface StripeSummary {
  currency: string;
  balanceAvailable: number;
  balancePending: number;
  /** Active subscriptions normalised to one month. */
  mrr: number;
  activeSubscriptions: number;
  payments30d: { count: number; volume: number };
  failed7d: Array<{
    id: string;
    amount: number;
    currency: string;
    created: string;
    description: string | null;
  }>;
  nextPayout: { amount: number; arrivalDate: string; status: string } | null;
}

/** Amounts are major units (e.g. euros), as Revolut Business reports them. */
export interface RevolutSummary {
  /** Sum of active account balances per currency. */
  balances: Array<{ currency: string; amount: number }>;
  /** Per currency, completed transactions over the last 30 days. */
  flows30d: Array<{ currency: string; inflow: number; outflow: number }>;
  recent: Array<{
    id: string;
    createdAt: string;
    type: string;
    state: string;
    description: string;
    amount: number;
    currency: string;
  }>;
  /** Alert threshold in account currency (absolute amount). */
  largeTransactionThreshold: number;
}

export interface SuperlogSummary {
  openIncidents: number;
  incidents24h: number;
  firingAlerts: number;
  errors24h: number | null;
  incidents: Array<{
    id: string;
    title: string;
    status: string;
    severity: string | null;
    service: string | null;
    startedAt: string | null;
  }>;
  services: Array<{ name: string; openIncidents: number; errors24h: number }>;
}

export interface SeoSummary {
  domain: string;
  organicTraffic: number | null;
  keywordsCount: number | null;
  referringDomains: number | null;
  topKeywords: Array<{
    keyword: string;
    position: number | null;
    previousPosition: number | null;
    volume: number | null;
  }>;
}

export const COCKPIT_PROVIDERS = [
  "website",
  "vercel",
  "stripe",
  "revolut",
  "superlog",
  "seo",
] as const;

export type CockpitProvider = (typeof COCKPIT_PROVIDERS)[number];

/** Connection health as the CONNECT console shows it. */
export interface ConnectionState {
  provider: CockpitProvider;
  connected: boolean;
  enabled: boolean;
  lastOkAt: string | null;
  lastError: string | null;
}

export interface CockpitData {
  marketing: Feed<MarketingSummary>;
  products: Feed<ProductHealth[]>;
  stripe: Feed<StripeSummary>;
  revolut: Feed<RevolutSummary>;
  superlog: Feed<SuperlogSummary>;
  seo: Feed<SeoSummary>;
  connections: ConnectionState[];
  generatedAt: string;
}
