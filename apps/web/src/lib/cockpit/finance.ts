import { fromMinor } from "./format";
import type { Feed, RevolutSummary, StripeSummary } from "./types";

/**
 * The FINANCE display's numbers, in one display currency (Stripe's account
 * currency, else Revolut's largest balance). Amounts in other currencies are
 * listed separately, never converted.
 */
export type FinanceSnapshot = {
  currency: string;
  mrr: number | null;
  cash: number | null;
  otherCash: Array<{ currency: string; amount: number }>;
  payments30d: { count: number; volume: number } | null;
  inflow30d: number | null;
  outflow30d: number | null;
  /** Net monthly outflow; null when cash flow is positive or unknown. */
  burn: number | null;
  runwayMonths: number | null;
  failed7d: number | null;
  nextPayout: { amount: number; arrivalDate: string } | null;
};

export function financeSnapshot(
  stripe: Feed<StripeSummary>,
  revolut: Feed<RevolutSummary>,
): FinanceSnapshot | null {
  const s = stripe.status === "live" ? stripe.data : null;
  const r = revolut.status === "live" ? revolut.data : null;
  if (!s && !r) return null;

  const currency = (
    s?.currency ??
    r?.balances[0]?.currency ??
    "EUR"
  ).toUpperCase();
  const same = (c: string) => c.toUpperCase() === currency;

  const revolutCash = r
    ? r.balances
        .filter((b) => same(b.currency))
        .reduce((n, b) => n + b.amount, 0)
    : 0;
  const stripeCash = s ? fromMinor(s.balanceAvailable, s.currency) : 0;
  const flow = r?.flows30d.find((f) => same(f.currency));
  const net = flow ? flow.inflow - flow.outflow : null;
  const cash = s || r ? revolutCash + stripeCash : null;
  const burn = net !== null && net < 0 ? -net : null;

  return {
    currency,
    mrr: s ? fromMinor(s.mrr, s.currency) : null,
    cash,
    otherCash: (r?.balances ?? []).filter((b) => !same(b.currency)),
    payments30d: s
      ? {
          count: s.payments30d.count,
          volume: fromMinor(s.payments30d.volume, s.currency),
        }
      : null,
    inflow30d: flow ? flow.inflow : null,
    outflow30d: flow ? flow.outflow : null,
    burn,
    runwayMonths:
      burn && cash !== null && burn > 0
        ? Math.round((cash / burn) * 10) / 10
        : null,
    failed7d: s ? s.failed7d.length : null,
    nextPayout: s?.nextPayout
      ? {
          amount: fromMinor(s.nextPayout.amount, s.currency),
          arrivalDate: s.nextPayout.arrivalDate,
        }
      : null,
  };
}
