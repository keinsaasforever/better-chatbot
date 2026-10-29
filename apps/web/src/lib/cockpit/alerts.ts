import "server-only";

import { createNotifications } from "lib/notifications/create-notifications";
import logger from "logger";
import { fromMinor } from "./format";
import type {
  CockpitProvider,
  Feed,
  ProductHealth,
  RevolutSummary,
  StripeSummary,
  SuperlogSummary,
} from "./types";
import { type CockpitUpdateSeverity, cockpitUpdateType } from "./updates";

/**
 * Server-side alerts derived from a feed refresh. Each alert has a stable
 * event id, and `<provider>:<eventId>` is the notification dedupe key, so a
 * refresh that sees the same failed deploy again inserts nothing and pushes
 * nothing: no snapshot table is needed.
 *
 * Rows are written in plain English (title + one-sentence body), like other
 * server notifications: the header bell shows them verbatim. The severity
 * rides on the notification type (`cockpit_update.alert`, see `updates.ts`).
 */

export type CockpitAlert = {
  provider: CockpitProvider;
  eventId: string;
  severity: CockpitUpdateSeverity;
  /** One line for the UPDATES display, the bell and push notifications. */
  title: string;
  /** One plain sentence of detail; never JSON. */
  body: string;
};

const MAX_PER_PROVIDER = 5;

const money = (amount: number, currency: string) =>
  `${amount.toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${currency.toUpperCase()}`;

export function collectAlerts(feeds: {
  products: Feed<ProductHealth[]>;
  stripe: Feed<StripeSummary>;
  revolut: Feed<RevolutSummary>;
  superlog: Feed<SuperlogSummary>;
}): CockpitAlert[] {
  const alerts: CockpitAlert[] = [];

  if (feeds.products.status === "live") {
    for (const product of feeds.products.data) {
      const deploy = product.deploy;
      if (deploy.status === "live" && deploy.data.state === "ERROR") {
        alerts.push({
          provider: "vercel",
          eventId: deploy.data.id,
          severity: "alert",
          title: `Deploy failed: ${product.label}`,
          body: `The latest ${product.label} deployment on Vercel ended in ERROR.`,
        });
      }
    }
  }

  if (feeds.superlog.status === "live") {
    for (const incident of feeds.superlog.data.incidents.slice(
      0,
      MAX_PER_PROVIDER,
    )) {
      alerts.push({
        provider: "superlog",
        eventId: incident.id,
        severity: incident.severity === "SEV-1" ? "alert" : "warn",
        title: `New incident: ${incident.title}`,
        body: [
          "Open incident in Superlog",
          incident.service ? `on ${incident.service}` : null,
          incident.severity ? `(${incident.severity})` : null,
        ]
          .filter(Boolean)
          .join(" ")
          .concat("."),
      });
    }
  }

  if (feeds.stripe.status === "live") {
    for (const charge of feeds.stripe.data.failed7d.slice(
      0,
      MAX_PER_PROVIDER,
    )) {
      const amount = fromMinor(charge.amount, charge.currency);
      alerts.push({
        provider: "stripe",
        eventId: charge.id,
        severity: "warn",
        title: `Payment failed: ${money(amount, charge.currency)}`,
        body: charge.description
          ? `A Stripe charge failed in the last 7 days: ${charge.description}.`
          : "A Stripe charge failed in the last 7 days.",
      });
    }
  }

  if (feeds.revolut.status === "live") {
    const { recent, largeTransactionThreshold } = feeds.revolut.data;
    for (const tx of recent) {
      if (largeTransactionThreshold <= 0) break;
      if (Math.abs(tx.amount) < largeTransactionThreshold) continue;
      alerts.push({
        provider: "revolut",
        eventId: tx.id,
        severity: "info",
        title: `Large transaction: ${money(tx.amount, tx.currency)} · ${tx.description}`,
        body: `A Revolut transaction at or above the ${money(largeTransactionThreshold, tx.currency)} alert threshold.`,
      });
    }
  }

  return alerts;
}

/**
 * Posts alerts to the UPDATES feed of each provider connection's owner.
 * Failures are logged and swallowed: alerts must never break the page.
 */
export async function dispatchAlerts(
  alerts: CockpitAlert[],
  ownerByProvider: Partial<Record<CockpitProvider, string>>,
): Promise<number> {
  let inserted = 0;
  await Promise.allSettled(
    alerts.map(async (alert) => {
      const owner = ownerByProvider[alert.provider];
      if (!owner) return;
      try {
        const result = await createNotifications({
          userIds: [owner],
          type: cockpitUpdateType(alert.severity),
          title: alert.title.slice(0, 200),
          body: alert.body.slice(0, 500),
          url: "/cockpit",
          dedupeKey: `${alert.provider}:${alert.eventId}`,
          push: { kind: "cockpit", tag: `cockpit-${alert.provider}` },
        });
        inserted += result.inserted.length;
      } catch (error) {
        logger.warn(
          "[cockpit] alert dispatch failed",
          alert.provider,
          error instanceof Error ? error.name : "unknown",
        );
      }
    }),
  );
  return inserted;
}
