"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CHANNEL_LABELS, isChannel } from "lib/cockpit/channels";
import type {
  BreakdownKey,
  BreakdownRow,
  Feed,
  MarketingSummary,
  SeoSummary,
} from "lib/cockpit/types";
import { reasonText } from "lib/cockpit/reasons";
import { cn } from "lib/utils";
import { colorFor } from "./channel-nd";
import {
  ConsoleInop,
  ConsoleOverlay,
  ConsolePushbutton,
  GLASS,
  Kpi,
  feedButtonState,
} from "./console-overlay";
import { CK, MONO } from "./instruments";
import { SeoCard } from "./seo-card";

/**
 * The MARKETING overhead pushbutton plus the glass console it opens over the
 * windshield: DataFast-style breakdowns (channel, referrer, campaign, keyword,
 * geo, pages, tech) from the first-party collector.
 */

// Distinct slice colors for the channel donut (and its legend dots); the
// ND's semantic colors repeat cyan for every organic channel.
const SLICE_COLORS = [
  "#4fb3e8",
  "#c9d3dd",
  "#3df08a",
  "#ff5bd1",
  "#7c8cff",
  "#ffb547",
  "#5fd4c4",
  "#e88f6a",
  "#a3e635",
  "#f472b6",
];

const CARDS: ReadonlyArray<readonly BreakdownKey[]> = [
  ["channel", "referrer", "campaign", "keyword"],
  ["country", "region", "city"],
  ["page", "entry", "hostname"],
  ["browser", "os", "device"],
];

type T = ReturnType<typeof useTranslations<"Cockpit">>;

export function MarketingConsole({
  marketing,
  seo,
  connected,
}: {
  marketing: Feed<MarketingSummary>;
  seo: Feed<SeoSummary>;
  connected: boolean;
}) {
  const t = useTranslations("Cockpit");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const state = feedButtonState(
    marketing.status === "live" || seo.status === "live" ? "live" : "inop",
    connected,
  );

  const compact = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const pct = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
      }),
    [locale],
  );
  const m = marketing.status === "live" ? marketing.data : null;

  return (
    <>
      <ConsolePushbutton
        label={t("overhead.marketing.label")}
        detail={t("overhead.marketing.detail")}
        state={state}
        stateLabel={t(`status.${state}`)}
        actionLabel={t("console.openHint")}
        open={open}
        onOpenChange={setOpen}
      />
      <ConsoleOverlay
        open={open}
        onOpenChange={setOpen}
        title={t("console.title")}
        subtitle={m ? t("header.range", { days: m.rangeDays }) : undefined}
        closeLabel={t("console.close")}
        kpis={
          m && (
            <>
              <Kpi
                label={t("console.visitsLabel")}
                value={compact.format(m.visits)}
              />
              <Kpi
                label={t("console.leadsLabel")}
                value={compact.format(m.leads)}
                tone={CK.magenta}
              />
              <Kpi
                label={t("fcu.conversion")}
                value={pct.format(m.conversionRate)}
                tone={CK.green}
              />
            </>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {m ? (
            CARDS.map((tabs) => (
              <BreakdownCard
                key={tabs[0]}
                tabs={tabs}
                summary={m}
                t={t}
                locale={locale}
                format={compact}
              />
            ))
          ) : (
            <div className="md:col-span-2">
              <ConsoleInop
                title={t("console.inopTitle")}
                reason={
                  marketing.status === "inop"
                    ? reasonText(t, marketing.reason)
                    : ""
                }
              />
            </div>
          )}
          <SeoCard seo={seo} format={compact} />
        </div>
      </ConsoleOverlay>
    </>
  );
}

function BreakdownCard({
  tabs,
  summary,
  t,
  locale,
  format,
}: {
  tabs: readonly BreakdownKey[];
  summary: MarketingSummary;
  t: T;
  locale: string;
  format: Intl.NumberFormat;
}) {
  const [active, setActive] = useState<BreakdownKey>(tabs[0]);
  const rows = summary.breakdowns[active] ?? [];
  const labeler = useLabeler(locale);

  return (
    <section className={cn(GLASS, "flex min-h-[22rem] flex-col p-3 md:p-4")}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div
          role="tablist"
          className="flex flex-wrap gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10"
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={active === tab}
              onClick={() => setActive(tab)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4fd8ff]",
                active === tab
                  ? "bg-white/15 text-white"
                  : "text-white/60 hover:text-white",
              )}
            >
              {t(`console.tabs.${tab}`)}
            </button>
          ))}
        </div>
        <span className="shrink-0 text-sm font-medium text-white/80">
          {active === "page" ? t("pfd.pageviews") : t("console.visitsLabel")}
        </span>
      </div>

      <div role="tabpanel" className="min-h-0 flex-1">
        {rows.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center text-sm text-white/60">
            {t("console.empty")}
          </div>
        ) : active === "channel" ? (
          <ChannelDonut
            rows={rows}
            total={summary.visits}
            t={t}
            format={format}
            labeler={labeler}
          />
        ) : (
          <BarRows
            rows={rows}
            dimension={active}
            format={format}
            labeler={labeler}
            leadsLabel={t("console.leadsLabel")}
          />
        )}
      </div>
    </section>
  );
}

type Labeler = (
  dimension: BreakdownKey,
  key: string,
) => { label: string; icon?: string; color?: string };

function flagOf(code: string): string | undefined {
  if (!/^[A-Z]{2}$/.test(code)) return undefined;
  return String.fromCodePoint(
    ...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

function useLabeler(locale: string): Labeler {
  return useMemo(() => {
    let regions: Intl.DisplayNames | null = null;
    try {
      regions = new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      regions = null;
    }
    const countryName = (code: string) => {
      try {
        return regions?.of(code) ?? code;
      } catch {
        return code;
      }
    };
    return (dimension, key) => {
      if (dimension === "channel" && isChannel(key)) {
        return { label: CHANNEL_LABELS[key], color: colorFor(key) };
      }
      if (dimension === "country") {
        return {
          label: /^[A-Z]{2}$/.test(key) ? countryName(key) : key,
          icon: flagOf(key),
        };
      }
      if (dimension === "region" && key.includes("-")) {
        const [country, region] = key.split("-");
        return {
          label: `${region} · ${countryName(country)}`,
          icon: flagOf(country),
        };
      }
      if (dimension === "device") {
        return { label: key.charAt(0).toUpperCase() + key.slice(1) };
      }
      return { label: key };
    };
  }, [locale]);
}

function BarRows({
  rows,
  dimension,
  format,
  labeler,
  leadsLabel,
}: {
  rows: BreakdownRow[];
  dimension: BreakdownKey;
  format: Intl.NumberFormat;
  labeler: Labeler;
  leadsLabel: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <ul className="max-h-[22rem] space-y-1 overflow-y-auto pr-1">
      {rows.map((row) => {
        const { label, icon, color } = labeler(dimension, row.key);
        return (
          <li
            key={row.key}
            className="relative flex h-9 items-center justify-between gap-3 overflow-hidden rounded-lg px-3"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-lg bg-[#3b6a92]/55"
              style={{ width: `${Math.max(2, (row.visits / max) * 100)}%` }}
            />
            <span className="relative flex min-w-0 items-center gap-2 text-sm text-white">
              {icon && <span aria-hidden>{icon}</span>}
              {color && (
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
              )}
              <span className="truncate">{label}</span>
            </span>
            <span className="relative shrink-0 text-sm tabular-nums text-white">
              {format.format(row.visits)}
              {row.leads > 0 && (
                <span
                  className="ml-2 rounded-md bg-[#ff5bd1]/20 px-1.5 py-0.5 text-xs"
                  style={{ color: CK.magenta }}
                >
                  {format.format(row.leads)} {leadsLabel}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ChannelDonut({
  rows,
  total,
  t,
  format,
  labeler,
}: {
  rows: BreakdownRow[];
  total: number;
  t: T;
  format: Intl.NumberFormat;
  labeler: Labeler;
}) {
  const size = 220;
  const r = 82;
  const stroke = 30;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const sum = Math.max(
    1,
    rows.reduce((n, row) => n + row.visits, 0),
  );
  const gap = rows.length > 1 ? 4 : 0;

  const lengths = rows.map((row) => (row.visits / sum) * circumference);
  const segments = rows.map((row, i) => ({
    row,
    length: Math.max(0, lengths[i] - gap),
    offset: lengths.slice(0, i).reduce((a, b) => a + b, 0),
  }));

  return (
    <div className="grid items-center gap-4 sm:grid-cols-[220px_1fr]">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto w-full max-w-[220px]"
        role="img"
        aria-label={t("console.tabs.channel")}
      >
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <g transform={`rotate(-90 ${c} ${c})`}>
          {segments.map(({ row, length, offset: o }) => (
            <circle
              key={row.key}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={
                SLICE_COLORS[
                  segments.findIndex((s) => s.row.key === row.key) %
                    SLICE_COLORS.length
                ]
              }
              strokeOpacity={0.75}
              strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-o}
            >
              <title>{`${labeler("channel", row.key).label}: ${row.visits}`}</title>
            </circle>
          ))}
        </g>
        <text
          x={c}
          y={c - 4}
          textAnchor="middle"
          fontSize={28}
          fill="#ffffff"
          style={MONO}
        >
          {format.format(total)}
        </text>
        <text
          x={c}
          y={c + 18}
          textAnchor="middle"
          fontSize={11}
          fill="rgba(255,255,255,0.7)"
          style={MONO}
        >
          {t("console.total")}
        </text>
      </svg>
      <BarRows
        rows={rows}
        dimension="channel"
        format={format}
        labeler={(dimension, key) => ({
          ...labeler(dimension, key),
          color:
            SLICE_COLORS[
              rows.findIndex((r) => r.key === key) % SLICE_COLORS.length
            ],
        })}
        leadsLabel={t("console.leadsLabel")}
      />
    </div>
  );
}
