import "server-only";

import { createHash } from "node:crypto";
import { serverCache } from "lib/cache";
import { isSecretBoxAvailable } from "lib/crypto/secret-box";
import type { CockpitConnectionEntity } from "lib/db/pg/schema.pg";
import { cockpitConnectionRepository } from "lib/db/repository";
import logger from "logger";
import { type CockpitAlert, collectAlerts, dispatchAlerts } from "./alerts";
import { type CockpitScope, openConfig } from "./connections";
import { fetchProvider } from "./providers";
import { reason } from "./reasons";
import {
  COCKPIT_PROVIDERS,
  type CockpitData,
  type CockpitProvider,
  type ConnectionState,
  type Feed,
  type MarketingSummary,
  type ProductHealth,
  type RevolutSummary,
  type SeoSummary,
  type StripeSummary,
  type SuperlogSummary,
} from "./types";

export type { CockpitData } from "./types";

export type { CockpitScope } from "./connections";

/** Feeds are refreshed at most once a minute per scope and config version. */
const FEEDS_TTL_MS = 60_000;
/** An alert already dispatched is not re-sent to the DB for a day. */
const ALERTED_TTL_MS = 24 * 60 * 60_000;

const inop = <T>(code: Parameters<typeof reason>[0]): Feed<T> => ({
  status: "inop",
  reason: reason(code),
});

function scopeKey(scope: CockpitScope) {
  return scope.organizationId ?? `user:${scope.userId}`;
}

/** Changes whenever a connection is added, removed, edited or toggled. */
function versionOf(rows: CockpitConnectionEntity[]) {
  return createHash("sha256")
    .update(
      rows
        .map((r) => `${r.id}:${r.updatedAt.getTime()}:${r.enabled}`)
        .sort()
        .join("|"),
    )
    .digest("hex")
    .slice(0, 16);
}

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Puts Superlog incidents onto the ENGINES columns. A project matches the
 * Superlog service whose name contains its key or label; a lone project gets
 * the totals.
 */
export function mergeIncidents(
  products: Feed<ProductHealth[]>,
  superlog: Feed<SuperlogSummary>,
): Feed<ProductHealth[]> {
  if (products.status !== "live") return products;
  const data = products.data.map((product): ProductHealth => {
    if (superlog.status !== "live") {
      return { ...product, incidents: superlog };
    }
    const key = normalise(product.key);
    const label = normalise(product.label);
    const service = superlog.data.services.find((s) => {
      const name = normalise(s.name);
      return name === key || name === label || name.includes(key);
    });
    if (service) {
      return {
        ...product,
        incidents: {
          status: "live",
          updatedAt: superlog.updatedAt,
          data: { open: service.openIncidents, errors24h: service.errors24h },
        },
      };
    }
    if (products.data.length === 1) {
      return {
        ...product,
        incidents: {
          status: "live",
          updatedAt: superlog.updatedAt,
          data: {
            open: superlog.data.openIncidents,
            errors24h: superlog.data.errors24h ?? 0,
          },
        },
      };
    }
    return { ...product, incidents: inop("serviceUnmatched") };
  });
  return { ...products, data };
}

type ProviderRun<T> = { feed: Feed<T>; state: ConnectionState };

async function runProvider<T>(
  provider: CockpitProvider,
  row: CockpitConnectionEntity | undefined,
): Promise<ProviderRun<T>> {
  const state = (patch: Partial<ConnectionState> = {}): ConnectionState => ({
    provider,
    connected: Boolean(row),
    enabled: row?.enabled ?? false,
    lastOkAt: row?.lastOkAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    ...patch,
  });
  if (!row) return { feed: inop("notConnected"), state: state() };
  if (!row.enabled) return { feed: inop("disabled"), state: state() };
  if (!isSecretBoxAvailable()) {
    const feed = inop<T>("secretsUnavailable");
    return { feed, state: state({ lastError: reason("secretsUnavailable") }) };
  }
  const config = openConfig(row);
  if (!config) {
    const feed = inop<T>("invalidConfig");
    return { feed, state: state({ lastError: reason("invalidConfig") }) };
  }

  const feed = await fetchProvider<T>(provider, config, {
    connectionId: row.id,
    version: row.updatedAt.toISOString(),
    scope: { userId: row.userId, organizationId: row.organizationId },
  });
  const ok = feed.status === "live";
  const error = feed.status === "inop" ? feed.reason : null;
  // Write only on a change (or a stale OK stamp) to spare the pool.
  const staleOk =
    ok && (!row.lastOkAt || Date.now() - row.lastOkAt.getTime() > 10 * 60_000);
  if (row.lastError !== error) {
    // Logged on change only: an open cockpit refreshes every minute.
    if (error) {
      logger.warn("[cockpit] feed inop", {
        "cockpit.provider": provider,
        "cockpit.reason": error,
      });
    } else {
      logger.info("[cockpit] feed live", { "cockpit.provider": provider });
    }
  }
  if (row.lastError !== error || staleOk) {
    await cockpitConnectionRepository
      .markResult(row.id, ok, error)
      .catch((e) =>
        logger.warn("[cockpit] markResult failed", provider, e?.name),
      );
  }
  return {
    feed,
    state: state({
      lastOkAt: ok
        ? new Date().toISOString()
        : (row.lastOkAt?.toISOString() ?? null),
      lastError: error,
    }),
  };
}

async function sendNewAlerts(
  alerts: CockpitAlert[],
  rows: Map<CockpitProvider, CockpitConnectionEntity>,
) {
  const fresh: CockpitAlert[] = [];
  for (const alert of alerts) {
    const key = `cockpit:alerted:${alert.provider}:${alert.eventId}`;
    if (await serverCache.get(key)) continue;
    await serverCache.set(key, true, ALERTED_TTL_MS);
    fresh.push(alert);
  }
  if (!fresh.length) return;
  const owners: Partial<Record<CockpitProvider, string>> = {};
  for (const [provider, row] of rows) owners[provider] = row.userId;
  await dispatchAlerts(fresh, owners);
}

async function refresh(rows: CockpitConnectionEntity[]): Promise<CockpitData> {
  const byProvider = new Map(
    rows.map((r) => [r.provider as CockpitProvider, r] as const),
  );
  const [website, vercel, stripe, revolut, superlog, seo] = await Promise.all([
    runProvider<MarketingSummary>("website", byProvider.get("website")),
    runProvider<ProductHealth[]>("vercel", byProvider.get("vercel")),
    runProvider<StripeSummary>("stripe", byProvider.get("stripe")),
    runProvider<RevolutSummary>("revolut", byProvider.get("revolut")),
    runProvider<SuperlogSummary>("superlog", byProvider.get("superlog")),
    runProvider<SeoSummary>("seo", byProvider.get("seo")),
  ]);

  const products = mergeIncidents(vercel.feed, superlog.feed);
  try {
    await sendNewAlerts(
      collectAlerts({
        products,
        stripe: stripe.feed,
        revolut: revolut.feed,
        superlog: superlog.feed,
      }),
      byProvider,
    );
  } catch (error) {
    logger.warn("[cockpit] alerts failed", (error as Error)?.name);
  }

  const states = [website, vercel, stripe, revolut, superlog, seo].map(
    (r) => r.state,
  );
  return {
    marketing: website.feed,
    products,
    stripe: stripe.feed,
    revolut: revolut.feed,
    superlog: superlog.feed,
    seo: seo.feed,
    connections: COCKPIT_PROVIDERS.map(
      (p) => states.find((s) => s.provider === p) as ConnectionState,
    ),
    generatedAt: new Date().toISOString(),
  };
}

function allInop(code: Parameters<typeof reason>[0]): CockpitData {
  return {
    marketing: inop(code),
    products: inop(code),
    stripe: inop(code),
    revolut: inop(code),
    superlog: inop(code),
    seo: inop(code),
    connections: [],
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Every cockpit instrument for one scope (the active organization, or the
 * user alone when no organization is active). Connections are decrypted
 * server-side, all providers run in parallel under their own deadline, and
 * the result is cached per scope for 60 s. Nothing throws to the caller: a
 * feed without a usable source is INOP with a reason code.
 */
export async function getCockpitData(
  scope: CockpitScope,
): Promise<CockpitData> {
  let rows: CockpitConnectionEntity[];
  try {
    // Scoped read: org rows only while the user is a member (fail closed).
    rows = await cockpitConnectionRepository.listForScope(
      scope.userId,
      scope.organizationId,
    );
  } catch (error) {
    logger.error("[cockpit] could not load connections", error);
    return allInop("unreachable");
  }

  const cacheKey = `cockpit:feeds:${scopeKey(scope)}:${versionOf(rows)}`;
  const cached = await serverCache.get<CockpitData>(cacheKey);
  if (cached) return cached;

  const data = await refresh(rows);
  await serverCache.set(cacheKey, data, FEEDS_TTL_MS);
  return data;
}
