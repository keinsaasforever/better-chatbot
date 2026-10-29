import { getLocale, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { CHANNEL_LABELS } from "lib/cockpit/channels";
import { financeSnapshot } from "lib/cockpit/finance";
import { formatMoney, intlLocale } from "lib/cockpit/format";
import { reasonText } from "lib/cockpit/reasons";
import type {
  CockpitData,
  CockpitProvider,
  DeployState,
  Feed,
  ProductHealth,
} from "lib/cockpit/types";
import { ChannelNd } from "./channel-nd";
import { CockpitUpdates } from "./cockpit-updates";
import { ConnectConsole } from "./connect-console";
import { FinanceConsole } from "./finance-console";
import {
  CK,
  Display,
  FcuWindow,
  FlightPath,
  InopValue,
  MONO,
  Mcdu,
  Pushbutton,
  Readout,
  Trend,
} from "./instruments";
import { MarketingConsole } from "./marketing-console";
import { ProductConsole } from "./product-console";
import { UtcClock } from "./utc-clock";
import { VoicePushbutton } from "./voice-pushbutton";
import { Windshield } from "./windshield";
import { WorkspaceModeToggle } from "../workspace-mode-toggle";

type T = Awaited<ReturnType<typeof getTranslations<"Cockpit">>>;

const DEPLOY_COLOR: Record<DeployState, string> = {
  READY: CK.green,
  ERROR: CK.red,
  BUILDING: CK.amber,
  QUEUED: CK.amber,
  INITIALIZING: CK.amber,
  CANCELED: CK.dim,
  UNKNOWN: CK.dim,
};

/** Overhead functions without a data source yet: plain unlit pushbuttons. */
const UNWIRED_AFTER_PRODUCT = [
  "customers",
  "operations",
  "people",
  "legal",
] as const;

export async function CockpitShell({
  data,
  internalTraffic = false,
}: {
  data: CockpitData;
  /** The browser carries the marketing site's `ks_internal=1` cookie. */
  internalTraffic?: boolean;
}) {
  const t = await getTranslations("Cockpit");
  const locale = intlLocale(await getLocale());
  const int = new Intl.NumberFormat(locale);
  const pct = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const dateTime = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  const { marketing } = data;
  const connected = (provider: CockpitProvider) =>
    data.connections.some((c) => c.provider === provider && c.connected);
  const m = marketing.status === "live" ? marketing.data : null;
  const live = (feed: { status: "live" | "inop" }) =>
    feed.status === "live" ? t("status.live") : t("status.inop");
  const why = (feed: Feed<unknown>) =>
    feed.status === "inop" ? reasonText(t, feed.reason) : "";
  const products = data.products.status === "live" ? data.products.data : [];
  const deploysLive = products.filter((p) => p.deploy.status === "live");
  const deploysOk = deploysLive.filter(
    (p) => p.deploy.status === "live" && p.deploy.data.state === "READY",
  ).length;
  const topChannel = m?.channels[0]
    ? CHANNEL_LABELS[m.channels[0].channel].toUpperCase()
    : null;
  const rangeDays = m?.rangeDays ?? 30;
  const finance = financeSnapshot(data.stripe, data.revolut);
  const money = (
    amount: number | null,
    currency = finance?.currency ?? "EUR",
  ) => (amount === null ? "---" : formatMoney(locale, amount, currency));
  const superlog = data.superlog.status === "live" ? data.superlog.data : null;
  const unwired = (fn: string) => (
    <Pushbutton
      key={fn}
      label={t(`overhead.${fn}.label`)}
      detail={t(`overhead.${fn}.detail`)}
      state="off"
      stateLabel={t("status.inop")}
    />
  );

  return (
    <div
      className="min-h-full overflow-x-clip"
      style={{ backgroundColor: "#07090c", color: CK.white }}
    >
      {/* Overhead panel: one pushbutton per business function. */}
      <header className="relative bg-gradient-to-b from-[#1d2026] to-[#101215] px-4 pb-6 pt-4 shadow-[inset_0_-16px_32px_rgba(0,0,0,0.7)] md:px-8">
        <div className="mx-auto mb-4 flex max-w-[1600px] justify-center">
          <WorkspaceModeToggle variant="cockpit" />
        </div>
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl md:text-3xl" style={{ color: CK.white }}>
              {t("header.title")}
            </h1>
            <span
              className="text-xs tracking-wider"
              style={{ ...MONO, color: CK.backlight }}
            >
              {t("header.callsign")} · {t("header.flight")}
            </span>
          </div>
          <div
            className="flex items-center gap-4 text-xs"
            style={{ ...MONO, color: CK.backlight }}
          >
            <span className="flex items-center gap-2">
              {internalTraffic && (
                <span
                  role="img"
                  aria-label={t("header.internalTraffic")}
                  title={t("header.internalTraffic")}
                  className="size-1.5 rounded-full"
                  style={{
                    backgroundColor: CK.green,
                    boxShadow: `0 0 6px ${CK.green}`,
                  }}
                />
              )}
              <span>
                {t("header.utcLabel")}{" "}
                <span style={{ color: CK.green }}>
                  <UtcClock />
                </span>
              </span>
            </span>
            <span className="hidden sm:inline">
              {t("header.range", { days: rangeDays })}
            </span>
            <VoicePushbutton />
          </div>
        </div>
        <div className="mx-auto mt-5 max-w-[1600px]">
          <div
            className="mb-3 text-[10px] uppercase tracking-wider"
            style={{ ...MONO, color: CK.dim }}
          >
            {t("overhead.title")}
          </div>
          <div className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-5 lg:grid-cols-9">
            <MarketingConsole
              marketing={marketing}
              seo={data.seo}
              connected={connected("website") || connected("seo")}
            />
            {unwired("sales")}
            <FinanceConsole
              stripe={data.stripe}
              revolut={data.revolut}
              connected={connected("stripe") || connected("revolut")}
            />
            <ProductConsole
              superlog={data.superlog}
              connected={connected("superlog")}
            />
            {UNWIRED_AFTER_PRODUCT.map(unwired)}
            <ConnectConsole />
          </div>
        </div>
      </header>

      {/* Windshield: three.js scene behind a CSS window frame. */}
      <section
        id="cockpit-windshield"
        aria-label={t("a11y.windshield")}
        className="relative h-[42vh] max-h-[560px] min-h-[260px] overflow-hidden bg-[#03060d]"
      >
        <Windshield />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#101215] to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-[7%] bg-[#0b0d10]"
          style={{ clipPath: "polygon(0 0, 100% 0, 35% 100%, 0 100%)" }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-[7%] bg-[#0b0d10]"
          style={{ clipPath: "polygon(0 0, 100% 0, 100% 100%, 65% 100%)" }}
        />
      </section>

      {/* Glareshield: FCU windows with the headline numbers. */}
      <section
        aria-label={t("a11y.glareshield")}
        className="relative -mt-3 rounded-t-[2rem] bg-gradient-to-b from-[#22262c] to-[#15181c] px-4 pb-5 pt-5 shadow-[0_-10px_30px_rgba(0,0,0,0.7)] md:px-8"
      >
        <div className="mx-auto grid max-w-[1200px] grid-cols-3 gap-3 rounded-xl bg-[#191c21] p-3 ring-1 ring-black md:grid-cols-6">
          <FcuWindow
            label={t("fcu.visits")}
            value={m ? int.format(m.visits) : "---"}
            inop={!m}
          />
          <FcuWindow
            label={t("fcu.leads")}
            value={m ? int.format(m.leads) : "---"}
            inop={!m}
          />
          <FcuWindow
            label={t("fcu.conversion")}
            value={m ? pct.format(m.conversionRate) : "---"}
            inop={!m}
          />
          <FcuWindow
            label={t("fcu.topChannel")}
            value={topChannel ?? "---"}
            inop={!topChannel}
          />
          <FcuWindow
            label={t("fcu.deploys")}
            value={
              deploysLive.length
                ? t("fcu.deploysOk", { ok: deploysOk, total: products.length })
                : "---"
            }
            inop={!deploysLive.length}
          />
          <FcuWindow
            label={t("fcu.mrr")}
            value={finance?.mrr != null ? money(finance.mrr) : "---"}
            inop={finance?.mrr == null}
          />
        </div>
      </section>

      {/* Main instrument panel. */}
      <main className="bg-[#0e1013] px-3 pb-6 pt-4 md:px-6">
        <div className="mx-auto grid max-w-[1600px] gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Display
            title={t("pfd.title")}
            status={marketing.status}
            statusLabel={live(marketing)}
          >
            {m ? (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                  <Readout
                    label={t("pfd.visits")}
                    value={int.format(m.visits)}
                    sub={
                      <Trend
                        current={m.visits}
                        previous={m.previous.visits}
                        suffix={t("pfd.vsPrevious")}
                        newLabel={t("status.new")}
                      />
                    }
                  />
                  <Readout
                    label={t("pfd.leads")}
                    value={int.format(m.leads)}
                    tone="magenta"
                    sub={
                      <Trend
                        current={m.leads}
                        previous={m.previous.leads}
                        suffix={t("pfd.vsPrevious")}
                        newLabel={t("status.new")}
                      />
                    }
                  />
                  <Readout
                    label={t("fcu.conversion")}
                    value={pct.format(m.conversionRate)}
                    tone="green"
                  />
                  <Readout
                    label={t("pfd.bookingClicks")}
                    value={int.format(m.bookingClicks)}
                  />
                  <Readout
                    label={t("pfd.visitors")}
                    value={int.format(m.visitors)}
                  />
                  <Readout
                    label={t("pfd.pageviews")}
                    value={int.format(m.pageviews)}
                  />
                </div>
                <FlightPath
                  daily={m.daily}
                  labels={{
                    visits: t("pfd.chartLegendVisits"),
                    leads: t("pfd.chartLegendLeads"),
                  }}
                />
              </>
            ) : (
              <InopPanel t={t} reason={why(marketing)} />
            )}
          </Display>

          <Display
            title={t("nd.title")}
            status={marketing.status}
            statusLabel={live(marketing)}
          >
            {m?.channels.length ? (
              <>
                <ChannelNd
                  channels={m.channels}
                  totalVisits={m.visits}
                  leadsSuffix={t("nd.leadsSuffix")}
                  ariaLabel={t("a11y.channelShare")}
                />
                <p className="mt-2 text-[10px]" style={{ color: CK.dim }}>
                  {t("nd.caption")}
                </p>
              </>
            ) : m ? (
              <Empty text={t("status.noData")} />
            ) : (
              <InopPanel t={t} reason={why(marketing)} />
            )}
          </Display>

          <Display
            title={t("engines.title")}
            status={deploysLive.length || superlog ? "live" : "inop"}
            statusLabel={
              deploysLive.length || superlog
                ? t("status.live")
                : t("status.inop")
            }
            className="md:col-span-2 xl:col-span-1"
          >
            {superlog && (
              <dl
                aria-label={t("engines.superlog")}
                className="mb-3 grid grid-cols-3 gap-2 rounded-md bg-[#070a0c] p-2 text-center ring-1 ring-[#111a20]"
              >
                <EngineStat
                  label={t("engines.openIncidents")}
                  value={superlog.openIncidents}
                  alarm={superlog.openIncidents > 0}
                />
                <EngineStat
                  label={t("engines.incidents24h")}
                  value={superlog.incidents24h}
                  alarm={superlog.incidents24h > 0}
                />
                <EngineStat
                  label={t("engines.firingAlerts")}
                  value={superlog.firingAlerts}
                  alarm={superlog.firingAlerts > 0}
                />
              </dl>
            )}
            {products.length ? (
              <div className="grid grid-cols-2 gap-3">
                {products.map((p) => (
                  <EngineColumn
                    key={p.key}
                    product={p}
                    t={t}
                    dateTime={dateTime}
                  />
                ))}
              </div>
            ) : (
              <InopPanel t={t} reason={why(data.products)} />
            )}
          </Display>

          <Display
            title={t("pages.title")}
            status={marketing.status}
            statusLabel={live(marketing)}
          >
            {m ? (
              <div className="space-y-4">
                <BarList
                  rows={m.topPages.map((p) => ({
                    label: p.path,
                    value: p.pageviews,
                  }))}
                  empty={t("pages.empty")}
                  format={(n) => int.format(n)}
                  color={CK.cyan}
                />
                {m.topCampaigns.length > 0 && (
                  <div>
                    <div
                      className="mb-1 text-[11px] uppercase tracking-wide"
                      style={{ color: CK.cyan }}
                    >
                      {t("pages.campaignsTitle")}
                    </div>
                    <BarList
                      rows={m.topCampaigns.map((c) => ({
                        label: c.campaign,
                        value: c.visits,
                        extra: c.leads,
                      }))}
                      empty=""
                      format={(n) => int.format(n)}
                      color={CK.magenta}
                    />
                  </div>
                )}
              </div>
            ) : (
              <InopPanel t={t} reason={why(marketing)} />
            )}
          </Display>

          <Display
            title={t("leadsDisplay.title")}
            status={marketing.status}
            statusLabel={live(marketing)}
          >
            {m ? (
              m.recentLeads.length ? (
                <ol className="space-y-2 text-xs">
                  {m.recentLeads.map((lead, i) => (
                    <li
                      key={`${lead.at}-${i}`}
                      className="border-b border-[#0f1a21] pb-1.5 last:border-0"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="truncate" style={{ color: CK.green }}>
                          {CHANNEL_LABELS[lead.channel].toUpperCase()}
                        </span>
                        <span
                          className="shrink-0 tabular-nums"
                          style={{ color: CK.dim }}
                        >
                          {dateTime.format(new Date(lead.at))}
                        </span>
                      </div>
                      {lead.form && (
                        <div className="truncate" style={{ color: CK.white }}>
                          {formLabel(t, lead.form)}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              ) : (
                <Empty text={t("leadsDisplay.empty")} />
              )
            ) : (
              <InopPanel t={t} reason={why(marketing)} />
            )}
          </Display>
        </div>

        {/* Pedestal: MCDUs for todos + updates around the finance ECAM. */}
        <div className="mx-auto mt-3 grid max-w-[1600px] gap-3 md:grid-cols-3">
          <Mcdu
            title={t("mcdu.todos.title")}
            lines={[t("mcdu.todos.line1"), t("mcdu.todos.line2"), "", "", ""]}
          />
          <Display
            title={t("finance.title")}
            status={finance ? "live" : "inop"}
            statusLabel={finance ? t("status.live") : t("status.inop")}
          >
            {finance ? (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <FinanceTile
                    label={t("finance.mrr")}
                    value={money(finance.mrr)}
                    reason={why(data.stripe)}
                    tone={CK.green}
                  />
                  <FinanceTile
                    label={t("finance.cash")}
                    value={money(finance.cash)}
                  />
                  <FinanceTile
                    label={t("finance.payments30d")}
                    value={
                      finance.payments30d
                        ? money(finance.payments30d.volume)
                        : "---"
                    }
                    reason={why(data.stripe)}
                  />
                  <FinanceTile
                    label={t("finance.inflow30d")}
                    value={money(finance.inflow30d)}
                    reason={why(data.revolut)}
                    tone={CK.green}
                  />
                  <FinanceTile
                    label={t("finance.outflow30d")}
                    value={money(finance.outflow30d)}
                    reason={why(data.revolut)}
                  />
                  <FinanceTile
                    label={t("finance.burn")}
                    value={
                      finance.burn !== null
                        ? money(finance.burn)
                        : finance.inflow30d !== null
                          ? t("finance.positiveFlow")
                          : "---"
                    }
                    reason={why(data.revolut)}
                    tone={finance.burn ? CK.amber : CK.green}
                  />
                  <FinanceTile
                    label={t("finance.runway")}
                    value={
                      finance.runwayMonths !== null
                        ? t("finance.runwayMonths", {
                            months: finance.runwayMonths,
                          })
                        : "---"
                    }
                  />
                  <FinanceTile
                    label={t("finance.failed7d")}
                    value={
                      finance.failed7d === null
                        ? "---"
                        : String(finance.failed7d)
                    }
                    reason={why(data.stripe)}
                    tone={finance.failed7d ? CK.red : CK.white}
                  />
                  <FinanceTile
                    label={t("finance.nextPayout")}
                    value={
                      finance.nextPayout
                        ? money(finance.nextPayout.amount)
                        : data.stripe.status === "live"
                          ? t("finance.noPayout")
                          : "---"
                    }
                    reason={why(data.stripe)}
                  />
                </div>
                {finance.otherCash.length > 0 && (
                  <p className="mt-2 text-[10px]" style={{ color: CK.dim }}>
                    {t("finance.otherCash", {
                      amounts: finance.otherCash
                        .map((c) => formatMoney(locale, c.amount, c.currency))
                        .join(" · "),
                    })}
                  </p>
                )}
              </>
            ) : (
              <InopPanel t={t} reason={why(data.stripe)} />
            )}
          </Display>
          <CockpitUpdates />
        </div>

        {m && marketing.status === "live" && (
          <p
            className="mx-auto mt-4 max-w-[1600px] text-right text-[10px]"
            style={{ ...MONO, color: CK.dim }}
          >
            {t("status.updated")}{" "}
            {dateTime.format(new Date(marketing.updatedAt))}
          </p>
        )}
      </main>
    </div>
  );
}

function EngineStat({
  label,
  value,
  alarm,
}: {
  label: string;
  value: number;
  alarm: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10px] uppercase" style={{ color: CK.cyan }}>
        {label}
      </dt>
      <dd
        className="text-lg tabular-nums"
        style={{ color: alarm ? CK.amber : CK.green }}
      >
        {value}
      </dd>
    </div>
  );
}

function FinanceTile({
  label,
  value,
  reason,
  tone = CK.white,
}: {
  label: string;
  value: string;
  reason?: string;
  tone?: string;
}) {
  const inop = value === "---";
  return (
    <div
      className="min-w-0 rounded-md bg-[#070a0c] p-2 ring-1 ring-[#111a20]"
      title={inop ? reason : undefined}
    >
      <div
        className="truncate text-[11px] uppercase tracking-wide"
        style={{ color: CK.cyan }}
      >
        {label}
      </div>
      <div
        className="truncate text-lg tabular-nums md:text-xl"
        style={{ color: inop ? CK.amber : tone }}
      >
        {value}
      </div>
    </div>
  );
}

function formLabel(t: T, form: string): string {
  const key = `leadsDisplay.formLabels.${form}`;
  return t.has(key) ? t(key) : form;
}

function InopPanel({ t, reason }: { t: T; reason: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 text-center">
      <span className="text-3xl tracking-wider" style={{ color: CK.amber }}>
        {t("status.inop")}
      </span>
      <span className="text-[11px]" style={{ color: CK.dim }}>
        {reason || t("status.notConnected")}
      </span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      className="flex h-full min-h-40 items-center justify-center text-sm"
      style={{ color: CK.dim }}
    >
      {text}
    </div>
  );
}

function BarList({
  rows,
  empty,
  format,
  color,
}: {
  rows: Array<{ label: string; value: number; extra?: number }>;
  empty: string;
  format: (n: number) => string;
  color: string;
}) {
  if (!rows.length) return empty ? <Empty text={empty} /> : null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5 text-[11px]">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-2">
            <span className="min-w-0 truncate" style={{ color: CK.white }}>
              {r.label}
            </span>
            <span className="shrink-0 tabular-nums" style={{ color: CK.white }}>
              {format(r.value)}
              {r.extra ? (
                <span style={{ color: CK.magenta }}> · {format(r.extra)}</span>
              ) : null}
            </span>
          </div>
          <div className="mt-0.5 h-1 rounded-full bg-[#0f1a21]">
            <div
              className="h-1 rounded-full"
              style={{
                width: `${(r.value / max) * 100}%`,
                backgroundColor: color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EngineColumn({
  product,
  t,
  dateTime,
}: {
  product: ProductHealth;
  t: T;
  dateTime: Intl.DateTimeFormat;
}) {
  const deploy = product.deploy.status === "live" ? product.deploy.data : null;
  const color = deploy ? DEPLOY_COLOR[deploy.state] : CK.amber;
  const name = product.label;
  const why = (feed: Feed<unknown>) =>
    feed.status === "inop" ? reasonText(t, feed.reason) : undefined;

  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <svg
        viewBox="0 0 100 70"
        className="w-full max-w-[120px]"
        role="img"
        aria-label={`${name}: ${deploy?.state ?? t("status.inop")}`}
      >
        <path
          d="M 14 58 A 40 40 0 1 1 86 58"
          fill="none"
          stroke="#1d2a33"
          strokeWidth={6}
          strokeLinecap="round"
        />
        <path
          d="M 14 58 A 40 40 0 1 1 86 58"
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={deploy?.state === "READY" ? undefined : "6 6"}
          opacity={deploy ? 1 : 0.8}
        />
        <text
          x={50}
          y={46}
          textAnchor="middle"
          fontSize={11}
          fill={color}
          style={MONO}
        >
          {deploy ? deploy.state : t("status.inop")}
        </text>
      </svg>
      <div
        className="text-center text-xs tracking-wider"
        style={{ color: CK.white }}
      >
        {name}
      </div>
      <dl className="w-full space-y-1 text-[11px]">
        <EngineRow label={t("engines.deploy")} title={why(product.deploy)}>
          {deploy ? (
            <span
              className="whitespace-nowrap"
              style={{ color: CK.white }}
              title={dateTime.format(new Date(deploy.createdAt))}
            >
              {ageLabel(deploy.createdAt)}
            </span>
          ) : (
            <InopValue />
          )}
        </EngineRow>
        <EngineRow label={t("engines.failed7d")}>
          {deploy ? (
            <span style={{ color: deploy.failedLast7d ? CK.red : CK.green }}>
              {deploy.failedLast7d}
            </span>
          ) : (
            <InopValue />
          )}
        </EngineRow>
        <EngineRow
          label={t("engines.incidents")}
          title={why(product.incidents)}
        >
          {product.incidents.status === "live" ? (
            <span style={{ color: CK.white }}>
              {product.incidents.data.open}
            </span>
          ) : (
            <InopValue />
          )}
        </EngineRow>
        <EngineRow
          label={t("engines.errors24h")}
          title={why(product.incidents)}
        >
          {product.incidents.status === "live" ? (
            <span style={{ color: CK.white }}>
              {product.incidents.data.errors24h}
            </span>
          ) : (
            <InopValue />
          )}
        </EngineRow>
        <EngineRow label={t("engines.spend")} title={why(product.spend)}>
          {product.spend.status === "live" ? (
            <span style={{ color: CK.white }}>
              €{product.spend.data.monthToDateEur}
            </span>
          ) : (
            <InopValue />
          )}
        </EngineRow>
        <EngineRow label={t("engines.margin")} title={why(product.margin)}>
          {product.margin.status === "live" ? (
            <span style={{ color: CK.white }}>
              {product.margin.data.grossMarginPct}%
            </span>
          ) : (
            <InopValue />
          )}
        </EngineRow>
      </dl>
    </div>
  );
}

/** Compact age for a timestamp: "<1h", "5h", "3d". */
function ageLabel(iso: string): string {
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.floor(hours)}h`;
  return `${Math.floor(hours / 24)}d`;
}

function EngineRow({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2" title={title}>
      <dt className="truncate" style={{ color: CK.cyan }}>
        {label}
      </dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
