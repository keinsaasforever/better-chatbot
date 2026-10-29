import "server-only";

import { createHash, createSign } from "node:crypto";
import { serverCache } from "lib/cache";
import { BASE_URL } from "lib/const";
import { reason } from "../reasons";
import type { RevolutSummary } from "../types";
import { ProviderHttpError, fetchJson, toReason } from "./http";
import { type RevolutConfig, revolutConfigSchema } from "./schemas";
import {
  type CockpitProviderModule,
  inop,
  live,
  type ProviderContext,
} from "./types";

/**
 * Revolut Business API. Auth is OAuth with a signed client assertion: an
 * RS256 JWT (iss = redirect-URI domain, sub = client id, aud =
 * https://revolut.com) is exchanged with the stored refresh token for a
 * 40-minute access token, cached per connection. The refresh token itself is
 * obtained once, from the authorization code Revolut issues on the consent
 * screen (see `prepare`).
 */

const PROD = "https://b2b.revolut.com/api/1.0";
const SANDBOX = "https://sandbox-b2b.revolut.com/api/1.0";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

const base = (config: Pick<RevolutConfig, "sandbox">) =>
  config.sandbox ? SANDBOX : PROD;

function issuerOf(config: Pick<RevolutConfig, "issuer">): string {
  if (config.issuer) return config.issuer;
  try {
    return new URL(BASE_URL).hostname;
  } catch {
    return "localhost";
  }
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

/** RS256 client-assertion JWT, valid for 60 minutes. */
export function clientAssertion(
  config: Pick<RevolutConfig, "clientId" | "privateKeyPem" | "issuer">,
  now = Math.floor(Date.now() / 1000),
): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: issuerOf(config),
      sub: config.clientId,
      aud: "https://revolut.com",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(config.privateKeyPem).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
};

async function tokenRequest(
  config: Pick<
    RevolutConfig,
    "clientId" | "privateKeyPem" | "issuer" | "sandbox"
  >,
  grant: Record<string, string>,
  signal: AbortSignal,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    ...grant,
    client_id: config.clientId,
    client_assertion_type: ASSERTION_TYPE,
    client_assertion: clientAssertion(config),
  });
  try {
    return await fetchJson<TokenResponse>(`${base(config)}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal,
    });
  } catch (error) {
    // Revolut answers an expired or revoked grant with 400/401.
    if (
      error instanceof ProviderHttpError &&
      (error.status === 400 || error.status === 401)
    ) {
      throw new ProviderHttpError(error.status, reason("reauthorize"));
    }
    throw error;
  }
}

function tokenCacheKey(config: RevolutConfig) {
  // Hash, so no secret ends up in a cache key.
  const digest = createHash("sha256")
    .update(`${config.clientId}:${config.refreshToken}:${config.sandbox}`)
    .digest("hex")
    .slice(0, 32);
  return `cockpit:revolut:token:${digest}`;
}

async function accessToken(
  config: RevolutConfig,
  ctx: ProviderContext,
): Promise<string> {
  const key = tokenCacheKey(config);
  const cached = await serverCache.get<string>(key);
  if (cached) return cached;
  const token = await tokenRequest(
    config,
    { grant_type: "refresh_token", refresh_token: config.refreshToken },
    ctx.signal,
  );
  const ttl = Math.max(60, (token.expires_in ?? 2400) - 120) * 1000;
  await serverCache.set(key, token.access_token, ttl);
  return token.access_token;
}

type Account = {
  id: string;
  balance: number;
  currency: string;
  state: string;
};

type Transaction = {
  id: string;
  type: string;
  state: string;
  created_at: string;
  completed_at?: string;
  reference?: string;
  legs: Array<{
    amount: number;
    currency: string;
    description?: string;
    account_id?: string;
  }>;
};

/** Pure aggregation, exported for tests. */
export function summarizeRevolut(input: {
  accounts: Account[];
  transactions: Transaction[];
  threshold: number;
}): RevolutSummary {
  const balances = new Map<string, number>();
  for (const a of input.accounts) {
    if (a.state !== "active") continue;
    balances.set(a.currency, (balances.get(a.currency) ?? 0) + a.balance);
  }

  const ownAccounts = new Set(input.accounts.map((a) => a.id));
  const flows = new Map<string, { inflow: number; outflow: number }>();
  for (const tx of input.transactions) {
    if (tx.state !== "completed" || tx.type === "exchange") continue;
    // A transfer between two of our own accounts is not money in or out.
    const internal =
      tx.legs.length > 1 &&
      tx.legs.every((l) => l.account_id && ownAccounts.has(l.account_id));
    if (internal) continue;
    for (const leg of tx.legs) {
      const f = flows.get(leg.currency) ?? { inflow: 0, outflow: 0 };
      if (leg.amount >= 0) f.inflow += leg.amount;
      else f.outflow += -leg.amount;
      flows.set(leg.currency, f);
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    balances: [...balances.entries()]
      .map(([currency, amount]) => ({ currency, amount: round(amount) }))
      .sort((a, b) => b.amount - a.amount),
    flows30d: [...flows.entries()].map(([currency, f]) => ({
      currency,
      inflow: round(f.inflow),
      outflow: round(f.outflow),
    })),
    recent: [...input.transactions]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 10)
      .map((tx) => {
        const leg = tx.legs[0];
        return {
          id: tx.id,
          createdAt: tx.created_at,
          type: tx.type,
          state: tx.state,
          description: (leg?.description ?? tx.reference ?? tx.type).slice(
            0,
            120,
          ),
          amount: leg?.amount ?? 0,
          currency: leg?.currency ?? "",
        };
      }),
    largeTransactionThreshold: input.threshold,
  };
}

async function api<T>(
  path: string,
  config: RevolutConfig,
  ctx: ProviderContext,
): Promise<T> {
  const token = await accessToken(config, ctx);
  return fetchJson<T>(`${base(config)}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: ctx.signal,
  });
}

export const revolutProvider: CockpitProviderModule<
  RevolutConfig,
  RevolutSummary
> = {
  provider: "revolut",
  configSchema: revolutConfigSchema,
  deadlineMs: 4000,

  async prepare(raw, ctx) {
    const code =
      typeof raw.authorizationCode === "string"
        ? raw.authorizationCode.trim()
        : "";
    const { authorizationCode: _drop, ...rest } = raw;
    if (!code) return { ok: true, config: rest };
    const parsed = revolutConfigSchema
      .pick({
        clientId: true,
        privateKeyPem: true,
        issuer: true,
        sandbox: true,
      })
      .safeParse(rest);
    if (!parsed.success) return { ok: false, reason: reason("invalidConfig") };
    try {
      const token = await tokenRequest(
        parsed.data,
        { grant_type: "authorization_code", code },
        ctx.signal,
      );
      if (!token.refresh_token) {
        return { ok: false, reason: reason("invalidResponse") };
      }
      return {
        ok: true,
        config: { ...rest, refreshToken: token.refresh_token },
      };
    } catch (error) {
      return { ok: false, reason: toReason(error) };
    }
  },

  async probe(config, ctx) {
    try {
      await api<Account[]>("/accounts", config, ctx);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: toReason(error) };
    }
  },

  async fetch(config, ctx) {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86_400_000);
    try {
      const [accounts, transactions] = await Promise.all([
        api<Account[]>("/accounts", config, ctx),
        api<Transaction[]>(
          `/transactions?from=${from.toISOString()}&to=${to.toISOString()}&count=1000`,
          config,
          ctx,
        ),
      ]);
      return live(
        summarizeRevolut({
          accounts,
          transactions,
          threshold: config.largeTransactionThreshold,
        }),
      );
    } catch (error) {
      return inop(toReason(error));
    }
  },
};
