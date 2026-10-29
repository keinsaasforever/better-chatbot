import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./feeds", () => ({ getCockpitData: vi.fn() }));

const { attentionItems, reasonForTools, summaryView, toToolData } =
  await import("./data");
import type { CockpitData, MarketingSummary } from "./types";

const at = "2026-10-07T10:00:00.000Z";
const live = <T>(data: T) => ({ status: "live" as const, data, updatedAt: at });
const inop = (reason: string) => ({ status: "inop" as const, reason });

const daily = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-09-${String(i + 1).padStart(2, "0")}`,
  // 100 visits a day, then 50 a day for the last week: -50 % week on week.
  visits: i >= 23 ? 50 : 100,
  leads: 1,
}));

const marketing: MarketingSummary = {
  rangeDays: 30,
  visits: 2_650,
  visitors: 2_000,
  pageviews: 4_000,
  leads: 30,
  bookingClicks: 12,
  conversionRate: 30 / 2_650,
  previous: { visits: 2_000, leads: 40 },
  channels: Array.from({ length: 12 }, (_, i) => ({
    channel: i === 0 ? ("google" as const) : ("direct" as const),
    visits: 100 - i,
    visitors: 90 - i,
    leads: 1,
  })),
  topPages: Array.from({ length: 8 }, (_, i) => ({
    path: `/p${i}`,
    pageviews: 10,
  })),
  topCampaigns: [],
  daily,
  recentLeads: [],
  breakdowns: {} as MarketingSummary["breakdowns"],
};

const data: CockpitData = {
  marketing: live(marketing),
  products: live(
    Array.from({ length: 14 }, (_, i) => ({
      key: `p${i}`,
      label: `P${i}`,
      deploy: live({
        id: `dpl_${i}`,
        state: i === 0 ? ("ERROR" as const) : ("READY" as const),
        createdAt: at,
        url: null,
        failedLast7d: i === 0 ? 2 : 0,
      }),
      incidents: inop("serviceUnmatched"),
      spend: inop("spendSource"),
      margin: inop("marginSource"),
    })),
  ),
  stripe: inop("notConnected"),
  revolut: inop("http|503"),
  superlog: live({
    openIncidents: 2,
    incidents24h: 3,
    firingAlerts: 1,
    errors24h: 40,
    incidents: Array.from({ length: 9 }, (_, i) => ({
      id: `inc_${i}`,
      title: `Incident ${i}`,
      status: "open",
      severity: null,
      service: "web",
      startedAt: at,
    })),
    services: [],
  }),
  seo: live({
    domain: "keinsaas.com",
    organicTraffic: 1_200,
    keywordsCount: 300,
    referringDomains: 40,
    topKeywords: Array.from({ length: 50 }, (_, i) => ({
      keyword: `kw ${i}`,
      position: 5,
      previousPosition: 8,
      volume: 100,
    })),
  }),
  connections: [],
  generatedAt: at,
};

describe("cockpit tool view", () => {
  it("turns reason codes into English and keeps unknown text", () => {
    expect(reasonForTools("notConnected")).toBe("Not connected");
    expect(reasonForTools("http|503")).toBe("Provider error (HTTP 503)");
    expect(reasonForTools("something else")).toBe("something else");
  });

  it("combines two INOP sources into one reason", () => {
    expect(toToolData(data).finance).toEqual({
      status: "inop",
      reason: "Stripe: Not connected; Revolut: Provider error (HTTP 503)",
    });
  });

  it("caps every list at ten rows and leaves the breakdowns out", () => {
    const view = toToolData(data);
    const json = JSON.stringify(view);
    expect(json).not.toContain("breakdowns");
    expect(json).not.toContain("daily");
    if (view.marketing.status !== "live") throw new Error("expected live");
    expect(view.marketing.data.topChannels).toHaveLength(5);
    expect(view.marketing.data.weekOverWeek).toEqual({
      visitsLast7d: 350,
      visitsPrior7d: 700,
      changePct: -50,
    });
    if (view.productHealth.status !== "live") throw new Error("expected live");
    const { deploys, incidents } = view.productHealth.data;
    expect("projects" in deploys && deploys.projects).toHaveLength(10);
    expect("failing" in deploys && deploys.failing).toEqual(["P0"]);
    expect("latest" in incidents && incidents.latest).toHaveLength(5);
    if (view.seo.status !== "live") throw new Error("expected live");
    expect(view.seo.data.topKeywords).toHaveLength(10);
    expect(view.seo.data.topKeywords[0].change).toBe(3);
  });

  it("lists what needs attention first", () => {
    expect(attentionItems(toToolData(data))).toEqual([
      "Deploy failing: P0",
      "2 open incident(s)",
      "Website visits down 50 % week on week",
    ]);
  });

  it("keeps the summary to headline numbers", () => {
    const summary = JSON.parse(JSON.stringify(summaryView(toToolData(data))));
    expect(summary.productHealth.data.deploys).toEqual({
      projects: 14,
      failing: ["P0"],
    });
    expect(summary.productHealth.data.incidents.latest).toBeUndefined();
    expect(summary.marketing.data.topPages).toBeUndefined();
    expect(summary.seo.data.topKeywords).toHaveLength(3);
    expect(JSON.stringify(summary).length).toBeLessThan(2_500);
  });
});
