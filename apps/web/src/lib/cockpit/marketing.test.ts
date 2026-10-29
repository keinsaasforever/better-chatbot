import { describe, expect, it } from "vitest";
import { type SiteEventRow, summarize } from "./marketing";

const now = new Date("2026-10-01T12:00:00Z");
const daysAgo = (d: number) =>
  new Date(now.getTime() - d * 86_400_000).toISOString();

function pv(
  at: string,
  channel: string,
  visitor: string,
  landing: boolean,
  path = "/",
): SiteEventRow {
  return {
    created_at: at,
    kind: "pageview",
    name: null,
    path,
    is_landing: landing,
    channel,
    source: channel,
    utm_campaign: null,
    visitor_hash: visitor,
    props: null,
  };
}

function ev(
  at: string,
  name: string,
  channel: string,
  form?: string,
): SiteEventRow {
  return {
    created_at: at,
    kind: "event",
    name,
    path: "/sales-agent",
    is_landing: false,
    channel,
    source: channel,
    utm_campaign: name === "lead" ? "launch" : null,
    visitor_hash: "v",
    props: form ? { form } : null,
  };
}

describe("summarize", () => {
  it("counts visits, leads and channels for the period", () => {
    const rows: SiteEventRow[] = [
      pv(daysAgo(1), "linkedin", "a", true, "/sales-agent"),
      pv(daysAgo(1), "linkedin", "a", false, "/pricing"),
      pv(daysAgo(2), "google", "b", true),
      pv(daysAgo(2), "chatgpt", "c", true),
      ev(daysAgo(1), "lead", "linkedin", "research_demo"),
      ev(daysAgo(1), "booking_cta_click", "google"),
      // previous period
      pv(daysAgo(40), "google", "z", true),
      ev(daysAgo(45), "lead", "google"),
      // outside both periods
      pv(daysAgo(90), "google", "y", true),
    ];
    const s = summarize(rows, 30, now);
    expect(s.visits).toBe(3);
    expect(s.pageviews).toBe(4);
    expect(s.visitors).toBe(3);
    expect(s.leads).toBe(1);
    expect(s.bookingClicks).toBe(1);
    expect(s.previous).toEqual({ visits: 1, leads: 1 });
    expect(Math.round(s.conversionRate * 1000) / 1000).toBe(0.333);
    expect(s.channels[0].channel).toBe("linkedin");
    expect(s.channels[0].leads).toBe(1);
    expect(s.daily).toHaveLength(30);
    expect(s.daily.reduce((n, d) => n + d.visits, 0)).toBe(3);
    expect(s.recentLeads[0].form).toBe("research_demo");
    expect(s.topCampaigns[0]).toEqual({
      campaign: "launch",
      visits: 0,
      leads: 1,
    });
  });

  it("falls back to referral for unknown channel values", () => {
    const s = summarize([pv(daysAgo(1), "myspace", "a", true)], 30, now);
    expect(s.channels[0].channel).toBe("referral");
  });

  it("gives a zeroed summary for empty input", () => {
    const s = summarize([], 7, now);
    expect(s.visits).toBe(0);
    expect(s.conversionRate).toBe(0);
    expect(s.daily).toHaveLength(7);
    expect(s.channels).toEqual([]);
  });

  it("counts visits per breakdown dimension and attributes leads", () => {
    const rows: SiteEventRow[] = [
      {
        ...pv(daysAgo(1), "linkedin", "a", true, "/sales-agent"),
        referrer_host: "linkedin.com",
        country: "DE",
        browser: "Chrome",
        os: "macOS",
        device: "desktop",
        host: "keinsaas.com",
      },
      { ...pv(daysAgo(1), "linkedin", "a", false, "/pricing"), country: "DE" },
      {
        ...pv(daysAgo(2), "google", "b", true, "/"),
        referrer_host: "google.com",
        country: "US",
        browser: "Safari",
        os: "iOS",
        device: "mobile",
      },
      {
        ...ev(daysAgo(1), "lead", "linkedin", "research_demo"),
        referrer_host: "linkedin.com",
        country: "DE",
      },
    ];
    const b = summarize(rows, 30, now).breakdowns;
    expect(b.channel[0]).toEqual({ key: "linkedin", visits: 1, leads: 1 });
    expect(b.referrer.find((r) => r.key === "linkedin.com")).toEqual({
      key: "linkedin.com",
      visits: 1,
      leads: 1,
    });
    expect(b.country[0]).toEqual({ key: "DE", visits: 1, leads: 1 });
    // Page counts every pageview; entry only landings; neither gets leads.
    expect(b.page).toHaveLength(3);
    expect(b.entry.map((r) => r.key).sort()).toEqual(["/", "/sales-agent"]);
    expect(b.entry.every((r) => r.leads === 0)).toBe(true);
    expect(
      b.browser
        .filter((r) => r.visits > 0)
        .map((r) => r.key)
        .sort(),
    ).toEqual(["Chrome", "Safari"]);
    expect(b.campaign).toEqual([{ key: "launch", visits: 0, leads: 1 }]);
  });

  it("falls back to (unknown) for rows without the newer columns", () => {
    const b = summarize(
      [pv(daysAgo(1), "direct", "a", true)],
      30,
      now,
    ).breakdowns;
    expect(b.browser[0]).toEqual({ key: "(unknown)", visits: 1, leads: 0 });
    expect(b.referrer[0]).toEqual({ key: "(direct)", visits: 1, leads: 0 });
  });
});
