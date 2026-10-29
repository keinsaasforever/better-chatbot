import "server-only";

import type { StripeSummary } from "../types";
import { fetchJson, toReason } from "./http";
import { type StripeConfig, stripeConfigSchema } from "./schemas";
import {
  type CockpitProviderModule,
  inop,
  live,
  type ProviderContext,
} from "./types";

/**
 * Stripe over plain REST with a restricted key (read access to balance,
 * subscriptions, charges and payouts). No SDK: four list endpoints are all
 * the cockpit needs.
 */

const API = "https://api.stripe.com/v1";
const DAY = 86_400;
const MAX_PAGES = 10;

type List<T> = { data: T[]; has_more: boolean };

type Balance = {
  available: Array<{ amount: number; currency: string }>;
  pending: Array<{ amount: number; currency: string }>;
};

type Price = {
  currency: string;
  unit_amount: number | null;
  unit_amount_decimal?: string | null;
  recurring: {
    interval: "day" | "week" | "month" | "year";
    interval_count: number;
  } | null;
};

type Subscription = {
  id: string;
  items: { data: Array<{ quantity?: number | null; price: Price }> };
};

type Charge = {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  created: number;
  status: "succeeded" | "pending" | "failed";
  paid: boolean;
  description: string | null;
};

type Payout = {
  amount: number;
  currency: string;
  arrival_date: number;
  status: string;
};

function get<T>(path: string, config: StripeConfig, ctx: ProviderContext) {
  return fetchJson<T>(`${API}${path}`, {
    headers: {
      Authorization: `Bearer ${config.restrictedKey}`,
      "Stripe-Version": "2024-06-20",
    },
    signal: ctx.signal,
  });
}

async function listAll<T extends { id: string }>(
  path: string,
  config: StripeConfig,
  ctx: ProviderContext,
): Promise<T[]> {
  const out: T[] = [];
  let startingAfter: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const cursor = startingAfter ? `&starting_after=${startingAfter}` : "";
    const res: List<T> = await get<List<T>>(
      `${path}${sep}limit=100${cursor}`,
      config,
      ctx,
    );
    out.push(...res.data);
    if (!res.has_more || !res.data.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }
  return out;
}

/** One subscription item's amount per month, in minor units. */
export function monthlyAmount(price: Price, quantity: number): number {
  if (!price.recurring) return 0;
  const unit =
    price.unit_amount ??
    (price.unit_amount_decimal ? Number(price.unit_amount_decimal) : 0);
  const count = Math.max(1, price.recurring.interval_count || 1);
  const perInterval = (unit * quantity) / count;
  switch (price.recurring.interval) {
    case "day":
      return (perInterval * 365) / 12;
    case "week":
      return (perInterval * 52) / 12;
    case "year":
      return perInterval / 12;
    default:
      return perInterval;
  }
}

/** Pure aggregation, exported for tests. */
export function summarizeStripe(input: {
  balance: Balance;
  subscriptions: Subscription[];
  charges: Charge[];
  payouts: Payout[];
  now: number;
}): StripeSummary {
  const currency =
    input.balance.available[0]?.currency ??
    input.balance.pending[0]?.currency ??
    "eur";
  const sum = (rows: Array<{ amount: number; currency: string }>) =>
    rows
      .filter((r) => r.currency === currency)
      .reduce((n, r) => n + r.amount, 0);

  let mrr = 0;
  for (const sub of input.subscriptions) {
    for (const item of sub.items?.data ?? []) {
      // Other currencies are not converted; discounts are not applied.
      if (item.price?.currency !== currency) continue;
      mrr += monthlyAmount(item.price, item.quantity ?? 1);
    }
  }

  const since30 = input.now - 30 * DAY;
  const since7 = input.now - 7 * DAY;
  const succeeded = input.charges.filter(
    (c) =>
      c.created >= since30 &&
      c.status === "succeeded" &&
      c.paid &&
      c.currency === currency,
  );
  const failed = input.charges
    .filter((c) => c.created >= since7 && c.status === "failed")
    .sort((a, b) => b.created - a.created);

  const upcoming =
    input.payouts.find(
      (p) => p.status === "pending" || p.status === "in_transit",
    ) ??
    input.payouts[0] ??
    null;

  return {
    currency,
    balanceAvailable: sum(input.balance.available),
    balancePending: sum(input.balance.pending),
    mrr: Math.round(mrr),
    activeSubscriptions: input.subscriptions.length,
    payments30d: {
      count: succeeded.length,
      volume: succeeded.reduce((n, c) => n + c.amount - c.amount_refunded, 0),
    },
    failed7d: failed.slice(0, 20).map((c) => ({
      id: c.id,
      amount: c.amount,
      currency: c.currency,
      created: new Date(c.created * 1000).toISOString(),
      description: c.description?.slice(0, 120) ?? null,
    })),
    nextPayout: upcoming
      ? {
          amount: upcoming.amount,
          arrivalDate: new Date(upcoming.arrival_date * 1000).toISOString(),
          status: upcoming.status,
        }
      : null,
  };
}

export const stripeProvider: CockpitProviderModule<
  StripeConfig,
  StripeSummary
> = {
  provider: "stripe",
  configSchema: stripeConfigSchema,
  deadlineMs: 4000,

  async probe(config, ctx) {
    try {
      await get<Balance>("/balance", config, ctx);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: toReason(error) };
    }
  },

  async fetch(config, ctx) {
    const now = Math.floor(Date.now() / 1000);
    try {
      const [balance, subscriptions, charges, payouts] = await Promise.all([
        get<Balance>("/balance", config, ctx),
        listAll<Subscription>("/subscriptions?status=active", config, ctx),
        listAll<Charge>(`/charges?created[gte]=${now - 30 * DAY}`, config, ctx),
        get<List<Payout>>("/payouts?limit=3", config, ctx),
      ]);
      return live(
        summarizeStripe({
          balance,
          subscriptions,
          charges,
          payouts: payouts.data,
          now,
        }),
      );
    } catch (error) {
      return inop(toReason(error));
    }
  },
};
