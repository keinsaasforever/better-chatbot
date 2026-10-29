import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("lib/cache", () => ({
  serverCache: {
    get: async (k: string) => cache.get(k),
    set: async (k: string, v: unknown) => void cache.set(k, v),
  },
}));

const { stripeProvider, summarizeStripe, monthlyAmount } = await import(
  "./stripe"
);
const { revolutProvider, clientAssertion, summarizeRevolut } = await import(
  "./revolut"
);
const { vercelProvider } = await import("./vercel");
const { parseProjectLines } = await import("./schemas");
const { websiteProvider } = await import("./website");

const signal = new AbortController().signal;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

type Route = [RegExp, (url: string, init?: RequestInit) => Response];
function mockFetch(routes: Route[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const hit = routes.find(([re]) => re.test(url));
      return hit ? hit[1](url, init) : json({ error: "no route" }, 404);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  cache.clear();
});

describe("stripe", () => {
  const config = { restrictedKey: "rk_test_abc" };
  const now = Math.floor(Date.now() / 1000);

  it("aggregates balance, MRR, payments, failures and payout", async () => {
    const calls = mockFetch([
      [
        /\/v1\/balance/,
        () =>
          json({
            available: [{ amount: 120_000, currency: "eur" }],
            pending: [{ amount: 5_000, currency: "eur" }],
          }),
      ],
      [
        /\/v1\/subscriptions/,
        () =>
          json({
            has_more: false,
            data: [
              {
                id: "sub_1",
                items: {
                  data: [
                    {
                      quantity: 2,
                      price: {
                        currency: "eur",
                        unit_amount: 4_900,
                        recurring: { interval: "month", interval_count: 1 },
                      },
                    },
                  ],
                },
              },
              {
                id: "sub_2",
                items: {
                  data: [
                    {
                      quantity: 1,
                      price: {
                        currency: "eur",
                        unit_amount: 120_000,
                        recurring: { interval: "year", interval_count: 1 },
                      },
                    },
                  ],
                },
              },
            ],
          }),
      ],
      [
        /\/v1\/charges/,
        () =>
          json({
            has_more: false,
            data: [
              {
                id: "ch_1",
                amount: 9_800,
                amount_refunded: 0,
                currency: "eur",
                created: now - 86_400,
                status: "succeeded",
                paid: true,
                description: null,
              },
              {
                id: "ch_2",
                amount: 4_900,
                amount_refunded: 0,
                currency: "eur",
                created: now - 3_600,
                status: "failed",
                paid: false,
                description: "Card declined",
              },
            ],
          }),
      ],
      [
        /\/v1\/payouts/,
        () =>
          json({
            data: [
              {
                amount: 50_000,
                currency: "eur",
                arrival_date: now + 86_400,
                status: "in_transit",
              },
            ],
          }),
      ],
    ]);
    const feed = await stripeProvider.fetch(config, { signal });
    expect(feed.status).toBe("live");
    if (feed.status !== "live") return;
    expect(feed.data.currency).toBe("eur");
    expect(feed.data.balanceAvailable).toBe(120_000);
    // 2 × 49 € monthly + 1200 € yearly / 12 = 198 €
    expect(feed.data.mrr).toBe(19_800);
    expect(feed.data.payments30d).toEqual({ count: 1, volume: 9_800 });
    expect(feed.data.failed7d.map((c) => c.id)).toEqual(["ch_2"]);
    expect(feed.data.nextPayout?.status).toBe("in_transit");
    expect(calls[0].init?.headers).toMatchObject({
      Authorization: "Bearer rk_test_abc",
    });
  });

  it("turns a rejected key into an unauthorized INOP without the body", async () => {
    mockFetch([
      [
        /./,
        () =>
          json(
            { error: { message: "Invalid API Key provided: rk_test_***abc" } },
            401,
          ),
      ],
    ]);
    expect(await stripeProvider.probe(config, { signal })).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    const feed = await stripeProvider.fetch(config, { signal });
    expect(feed).toEqual({ status: "inop", reason: "unauthorized" });
  });

  it("normalises intervals to a month", () => {
    const price = (interval: "day" | "week" | "month" | "year", count = 1) => ({
      currency: "eur",
      unit_amount: 1200,
      recurring: { interval, interval_count: count },
    });
    expect(monthlyAmount(price("year"), 1)).toBe(100);
    expect(monthlyAmount(price("month", 3), 1)).toBe(400);
    expect(Math.round(monthlyAmount(price("week"), 1))).toBe(5200);
    expect(
      summarizeStripe({
        balance: { available: [], pending: [] },
        subscriptions: [],
        charges: [],
        payouts: [],
        now,
      }).nextPayout,
    ).toBeNull();
  });
});

describe("revolut", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const config = {
    clientId: "client-1",
    privateKeyPem: pem,
    refreshToken: "refresh-1",
    sandbox: true,
    issuer: "app.example.com",
    largeTransactionThreshold: 5000,
  };

  it("signs an RS256 client assertion for revolut.com", () => {
    const jwt = clientAssertion(config, 1_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toMatchObject({
      iss: "app.example.com",
      sub: "client-1",
      aud: "https://revolut.com",
      exp: 4_600,
    });
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${p}`);
    expect(verify.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("refreshes a token, then reads balances and 30-day flows", async () => {
    const calls = mockFetch([
      [
        /\/auth\/token/,
        () => json({ access_token: "access-1", expires_in: 2400 }),
      ],
      [
        /\/accounts/,
        () =>
          json([
            { id: "a1", balance: 10_000, currency: "EUR", state: "active" },
            { id: "a2", balance: 500, currency: "EUR", state: "active" },
            { id: "a3", balance: 99, currency: "EUR", state: "inactive" },
          ]),
      ],
      [
        /\/transactions/,
        () =>
          json([
            {
              id: "t1",
              type: "card_payment",
              state: "completed",
              created_at: "2026-10-05T10:00:00Z",
              legs: [
                {
                  amount: -120,
                  currency: "EUR",
                  description: "Vercel",
                  account_id: "a1",
                },
              ],
            },
            {
              id: "t2",
              type: "topup",
              state: "completed",
              created_at: "2026-10-06T10:00:00Z",
              legs: [
                {
                  amount: 7_000,
                  currency: "EUR",
                  description: "Customer",
                  account_id: "a1",
                },
              ],
            },
            {
              id: "t3",
              type: "transfer",
              state: "completed",
              created_at: "2026-10-06T11:00:00Z",
              legs: [
                { amount: -50, currency: "EUR", account_id: "a1" },
                { amount: 50, currency: "EUR", account_id: "a2" },
              ],
            },
          ]),
      ],
    ]);
    const feed = await revolutProvider.fetch(config, { signal });
    expect(feed.status).toBe("live");
    if (feed.status !== "live") return;
    expect(feed.data.balances).toEqual([{ currency: "EUR", amount: 10_500 }]);
    expect(feed.data.flows30d).toEqual([
      { currency: "EUR", inflow: 7_000, outflow: 120 },
    ]);
    expect(feed.data.recent[0].id).toBe("t3");
    expect(calls[0].url).toContain(
      "sandbox-b2b.revolut.com/api/1.0/auth/token",
    );
    const body = String(calls[0].init?.body);
    expect(body).toContain("grant_type=refresh_token");
    expect(body).toContain("client_assertion_type=");
    const accountsCall = calls.find((c) => c.url.includes("/accounts"));
    expect(accountsCall?.init?.headers).toMatchObject({
      Authorization: "Bearer access-1",
    });
  });

  it("asks for reauthorization when the refresh token is rejected", async () => {
    mockFetch([[/\/auth\/token/, () => json({ error: "invalid_grant" }, 400)]]);
    expect(await revolutProvider.probe(config, { signal })).toEqual({
      ok: false,
      reason: "reauthorize",
    });
  });

  it("exchanges an authorization code once on save and drops the code", async () => {
    const calls = mockFetch([
      [
        /\/auth\/token/,
        () => json({ access_token: "a", refresh_token: "refresh-new" }),
      ],
    ]);
    const { refreshToken: _r, ...rest } = config;
    const prepared = await revolutProvider.prepare?.(
      { ...rest, authorizationCode: "code-123" },
      { signal },
    );
    expect(prepared).toEqual({
      ok: true,
      config: { ...rest, refreshToken: "refresh-new" },
    });
    expect(String(calls[0].init?.body)).toContain(
      "grant_type=authorization_code",
    );
    expect(String(calls[0].init?.body)).toContain("code=code-123");
  });

  it("flags nothing for a quiet account", () => {
    expect(
      summarizeRevolut({ accounts: [], transactions: [], threshold: 1 }).recent,
    ).toEqual([]);
  });
});

describe("vercel", () => {
  const config = {
    token: "vercel-token",
    teamId: "team_1",
    projects: [{ key: "navigator", projectId: "prj_1", label: "NAVIGATOR" }],
  };

  it("reads the latest production deployment and failures", async () => {
    const now = Date.now();
    const calls = mockFetch([
      [
        /api\.vercel\.com\/v6\/deployments/,
        () =>
          json({
            deployments: [
              {
                uid: "dpl_2",
                url: "nav.vercel.app",
                created: now - 3_600_000,
                state: "READY",
              },
              { uid: "dpl_1", created: now - 7_200_000, state: "ERROR" },
            ],
          }),
      ],
    ]);
    const feed = await vercelProvider.fetch(config, { signal });
    expect(feed.status).toBe("live");
    if (feed.status !== "live") return;
    const deploy = feed.data[0].deploy;
    expect(deploy).toMatchObject({
      status: "live",
      data: {
        id: "dpl_2",
        state: "READY",
        failedLast7d: 1,
        url: "https://nav.vercel.app",
      },
    });
    expect(calls[0].url).toContain("teamId=team_1");
  });

  it("is INOP unauthorized when the token is rejected", async () => {
    mockFetch([[/./, () => json({}, 403)]]);
    expect(await vercelProvider.fetch(config, { signal })).toEqual({
      status: "inop",
      reason: "unauthorized",
    });
  });

  const ready = () =>
    json({
      deployments: [{ uid: "dpl_1", created: Date.now(), state: "READY" }],
    });

  it("finds the team that owns the project when no team is set", async () => {
    const calls = mockFetch([
      [
        /\/v2\/teams/,
        () => json({ teams: [{ id: "team_a" }, { id: "team_b" }] }),
      ],
      [
        /\/v9\/projects\/prj_1/,
        (url) => (url.includes("teamId=team_b") ? json({}) : json({}, 404)),
      ],
      [/\/v6\/deployments/, ready],
    ]);
    const ctx = { signal, connectionId: "c1", version: "v1" };
    const feed = await vercelProvider.fetch({ ...config, teamId: "" }, ctx);
    expect(feed.status).toBe("live");
    const deploys = calls.filter((c) => c.url.includes("/v6/deployments"));
    expect(deploys[0].url).toContain("teamId=team_b");

    // The owner is cached per connection version: no second lookup.
    calls.length = 0;
    await vercelProvider.fetch({ ...config, teamId: "" }, ctx);
    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining("/v6/deployments"),
    ]);
  });

  it("falls back to the token's own scope when teams cannot be listed", async () => {
    const calls = mockFetch([
      [/\/v2\/teams/, () => json({}, 403)],
      [/\/v9\/projects\/prj_1/, () => json({}, 404)],
      [/\/v6\/deployments/, ready],
    ]);
    const feed = await vercelProvider.fetch(
      { ...config, teamId: "" },
      { signal },
    );
    expect(feed.status).toBe("live");
    const deploy = calls.find((c) => c.url.includes("/v6/deployments"));
    expect(deploy?.url).not.toMatch(/teamId=|slug=/);
  });

  it("sends a team slug as slug", async () => {
    const calls = mockFetch([[/\/v6\/deployments/, ready]]);
    await vercelProvider.fetch({ ...config, teamId: "acme" }, { signal });
    expect(calls[0].url).toContain("slug=acme");
    expect(calls[0].url).not.toContain("teamId=");
  });

  it("reads a bare project id or name as both id and label", () => {
    expect(
      parseProjectLines("NAVIGATOR = prj_1\nkeinsaas-website\n\n"),
    ).toEqual([
      { key: "navigator", label: "NAVIGATOR", projectId: "prj_1" },
      {
        key: "keinsaas-website",
        label: "keinsaas-website",
        projectId: "keinsaas-website",
      },
    ]);
  });
});

describe("website", () => {
  const config = {
    supabaseUrl: "https://abc.supabase.co",
    supabaseSecretKey: "sb_secret_x",
    rangeDays: 30,
  };

  it("summarises site_events rows", async () => {
    mockFetch([
      [
        /\/rest\/v1\/site_events/,
        () =>
          json([
            {
              created_at: new Date().toISOString(),
              kind: "pageview",
              name: null,
              path: "/",
              is_landing: true,
              channel: "google",
              source: "google",
              utm_campaign: null,
              visitor_hash: "v1",
              props: null,
            },
          ]),
      ],
    ]);
    const feed = await websiteProvider.fetch(config, { signal });
    expect(feed.status).toBe("live");
    if (feed.status === "live") expect(feed.data.visits).toBe(1);
  });

  it("is INOP unauthorized for a wrong key", async () => {
    mockFetch([[/./, () => json({ message: "Invalid API key" }, 401)]]);
    const feed = await websiteProvider.fetch(config, { signal });
    expect(feed).toEqual({ status: "inop", reason: "unauthorized" });
  });
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
