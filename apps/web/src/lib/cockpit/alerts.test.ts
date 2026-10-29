import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const createNotifications = vi.hoisted(() => vi.fn());
vi.mock("lib/notifications/create-notifications", () => ({
  createNotifications,
}));

const { collectAlerts, dispatchAlerts } = await import("./alerts");
const { financeSnapshot } = await import("./finance");

const inop = { status: "inop" as const, reason: "notConnected" };
const live = <T>(data: T) => ({
  status: "live" as const,
  data,
  updatedAt: new Date().toISOString(),
});

const feeds = {
  products: live([
    {
      key: "navigator",
      label: "NAVIGATOR",
      deploy: live({
        id: "dpl_9",
        state: "ERROR" as const,
        createdAt: new Date().toISOString(),
        url: null,
        failedLast7d: 1,
      }),
      incidents: inop,
      spend: inop,
      margin: inop,
    },
  ]),
  stripe: live({
    currency: "eur",
    balanceAvailable: 100_000,
    balancePending: 0,
    mrr: 50_000,
    activeSubscriptions: 3,
    payments30d: { count: 2, volume: 20_000 },
    failed7d: [
      {
        id: "ch_1",
        amount: 4_900,
        currency: "eur",
        created: "",
        description: null,
      },
    ],
    nextPayout: null,
  }),
  revolut: live({
    balances: [{ currency: "EUR", amount: 9_000 }],
    flows30d: [{ currency: "EUR", inflow: 1_000, outflow: 4_000 }],
    recent: [
      {
        id: "tx_big",
        createdAt: "",
        type: "card_payment",
        state: "completed",
        description: "Laptop",
        amount: -6_000,
        currency: "EUR",
      },
      {
        id: "tx_small",
        createdAt: "",
        type: "card_payment",
        state: "completed",
        description: "Coffee",
        amount: -4,
        currency: "EUR",
      },
    ],
    largeTransactionThreshold: 5_000,
  }),
  superlog: live({
    openIncidents: 1,
    incidents24h: 1,
    firingAlerts: 0,
    errors24h: 3,
    incidents: [
      {
        id: "inc_1",
        title: "Checkout 500s",
        status: "open",
        severity: "SEV-1",
        service: "web",
        startedAt: null,
      },
    ],
    services: [],
  }),
};

describe("cockpit alerts", () => {
  beforeEach(() => {
    createNotifications.mockReset();
  });

  it("raises one alert per failed deploy, incident, failed payment and large transaction", () => {
    const alerts = collectAlerts(feeds);
    expect(alerts.map((a) => `${a.provider}:${a.eventId}`)).toEqual([
      "vercel:dpl_9",
      "superlog:inc_1",
      "stripe:ch_1",
      "revolut:tx_big",
    ]);
    expect(alerts.map((a) => a.severity)).toEqual([
      "alert",
      "alert",
      "warn",
      "info",
    ]);
    expect(alerts[2].title).toBe("Payment failed: 49 EUR");
    expect(alerts[3].title).toBe("Large transaction: -6,000 EUR · Laptop");
  });

  it("dedupes replays through the notification dedupe key", async () => {
    // First refresh inserts, the replay hits the (user, dedupe_key) index.
    createNotifications
      .mockResolvedValueOnce({ inserted: [{ id: "n1", userId: "owner" }] })
      .mockResolvedValueOnce({ inserted: [] });
    const [alert] = collectAlerts({
      ...feeds,
      stripe: inop,
      revolut: inop,
      superlog: inop,
    });
    expect(await dispatchAlerts([alert], { vercel: "owner" })).toBe(1);
    expect(await dispatchAlerts([alert], { vercel: "owner" })).toBe(0);
    const calls = createNotifications.mock.calls.map((c) => c[0]);
    expect(calls[0].dedupeKey).toBe("vercel:dpl_9");
    expect(calls[1].dedupeKey).toBe(calls[0].dedupeKey);
    // Severity rides on the type; title and body are what the bell shows.
    expect(calls[0]).toEqual(
      expect.objectContaining({
        userIds: ["owner"],
        type: "cockpit_update.alert",
        title: "Deploy failed: NAVIGATOR",
        body: "The latest NAVIGATOR deployment on Vercel ended in ERROR.",
        url: "/cockpit",
      }),
    );
  });

  it("writes plain-text bodies, never JSON", async () => {
    createNotifications.mockResolvedValue({ inserted: [] });
    const alerts = collectAlerts(feeds);
    await dispatchAlerts(alerts, {
      vercel: "owner",
      superlog: "owner",
      stripe: "owner",
      revolut: "owner",
    });
    const calls = createNotifications.mock.calls.map((c) => c[0]);
    expect(calls.map((c) => c.type)).toEqual([
      "cockpit_update.alert",
      "cockpit_update.alert",
      "cockpit_update.warn",
      "cockpit_update",
    ]);
    for (const call of calls) {
      expect(call.body).not.toMatch(/^[[{]/);
    }
    expect(calls[1].body).toBe("Open incident in Superlog on web (SEV-1).");
  });

  it("skips providers without an owner and never throws", async () => {
    createNotifications.mockRejectedValue(new Error("db down"));
    const alerts = collectAlerts(feeds);
    await expect(dispatchAlerts(alerts, { stripe: "owner" })).resolves.toBe(0);
    expect(createNotifications).toHaveBeenCalledTimes(1);
  });
});

describe("financeSnapshot", () => {
  it("adds Revolut and Stripe cash in one currency and derives runway", () => {
    const f = financeSnapshot(feeds.stripe, feeds.revolut);
    expect(f).toMatchObject({
      currency: "EUR",
      mrr: 500,
      cash: 10_000,
      burn: 3_000,
      runwayMonths: 3.3,
      failed7d: 1,
    });
  });

  it("is null when neither source is live", () => {
    expect(financeSnapshot(inop, inop)).toBeNull();
  });
});
