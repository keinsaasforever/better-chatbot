"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { formatMoney, fromMinor, intlLocale } from "lib/cockpit/format";
import { reasonText } from "lib/cockpit/reasons";
import type { Feed, RevolutSummary, StripeSummary } from "lib/cockpit/types";
import { cn } from "lib/utils";
import {
  ConsoleInop,
  ConsoleOverlay,
  ConsolePushbutton,
  GLASS,
  Kpi,
  feedButtonState,
} from "./console-overlay";
import { CK, MONO } from "./instruments";

/** FINANCE overhead pushbutton: Stripe and Revolut tables on glass. */
export function FinanceConsole({
  stripe,
  revolut,
  connected,
}: {
  stripe: Feed<StripeSummary>;
  revolut: Feed<RevolutSummary>;
  connected: boolean;
}) {
  const t = useTranslations("Cockpit");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const anyLive = stripe.status === "live" || revolut.status === "live";
  const state = feedButtonState(anyLive ? "live" : "inop", connected);
  const dateFmt = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Berlin",
  });
  const s = stripe.status === "live" ? stripe.data : null;
  const r = revolut.status === "live" ? revolut.data : null;
  const minor = (amount: number, currency: string) =>
    formatMoney(locale, fromMinor(amount, currency), currency, false);

  return (
    <>
      <ConsolePushbutton
        label={t("overhead.finance.label")}
        detail={t("overhead.finance.detail")}
        state={state}
        stateLabel={t(`status.${state}`)}
        actionLabel={t("financeConsole.openHint")}
        open={open}
        onOpenChange={setOpen}
      />
      <ConsoleOverlay
        open={open}
        onOpenChange={setOpen}
        title={t("financeConsole.title")}
        closeLabel={t("console.close")}
        kpis={
          s && (
            <>
              <Kpi
                label={t("finance.mrr")}
                value={formatMoney(
                  locale,
                  fromMinor(s.mrr, s.currency),
                  s.currency,
                )}
                tone={CK.green}
              />
              <Kpi
                label={t("finance.failed7d")}
                value={String(s.failed7d.length)}
                tone={s.failed7d.length ? CK.red : CK.white}
              />
            </>
          )
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          {s ? (
            <section className={cn(GLASS, "p-4")}>
              <h3 className="mb-3 text-sm font-medium text-white">
                {t("connect.providers.stripe.name")}
              </h3>
              <Rows
                rows={[
                  [
                    t("financeConsole.balanceAvailable"),
                    minor(s.balanceAvailable, s.currency),
                  ],
                  [
                    t("financeConsole.balancePending"),
                    minor(s.balancePending, s.currency),
                  ],
                  [t("finance.mrr"), minor(s.mrr, s.currency)],
                  [
                    t("financeConsole.activeSubscriptions"),
                    String(s.activeSubscriptions),
                  ],
                  [
                    t("finance.payments30d"),
                    `${s.payments30d.count} · ${minor(s.payments30d.volume, s.currency)}`,
                  ],
                  [
                    t("finance.nextPayout"),
                    s.nextPayout
                      ? `${minor(s.nextPayout.amount, s.currency)} · ${dateFmt.format(new Date(s.nextPayout.arrivalDate))}`
                      : t("finance.noPayout"),
                  ],
                ]}
              />
              <h4
                className="mb-2 mt-4 text-xs uppercase tracking-wider"
                style={{ ...MONO, color: CK.cyan }}
              >
                {t("financeConsole.failedPayments")}
              </h4>
              {s.failed7d.length ? (
                <ul className="space-y-1 text-sm">
                  {s.failed7d.map((c) => (
                    <li
                      key={c.id}
                      className="flex justify-between gap-3 text-white/90"
                    >
                      <span className="truncate">{c.description ?? c.id}</span>
                      <span
                        className="shrink-0 tabular-nums"
                        style={{ color: CK.red }}
                      >
                        {minor(c.amount, c.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/60">
                  {t("financeConsole.noFailed")}
                </p>
              )}
            </section>
          ) : (
            <ConsoleInop
              title={t("connect.providers.stripe.name")}
              reason={
                stripe.status === "inop" ? reasonText(t, stripe.reason) : ""
              }
            />
          )}
          {r ? (
            <section className={cn(GLASS, "p-4")}>
              <h3 className="mb-3 text-sm font-medium text-white">
                {t("connect.providers.revolut.name")}
              </h3>
              <Rows
                rows={[
                  ...r.balances.map(
                    (b) =>
                      [
                        t("financeConsole.balanceIn", { currency: b.currency }),
                        formatMoney(locale, b.amount, b.currency, false),
                      ] as [string, string],
                  ),
                  ...r.flows30d.flatMap(
                    (f) =>
                      [
                        [
                          t("financeConsole.inflowIn", {
                            currency: f.currency,
                          }),
                          formatMoney(locale, f.inflow, f.currency, false),
                        ],
                        [
                          t("financeConsole.outflowIn", {
                            currency: f.currency,
                          }),
                          formatMoney(locale, f.outflow, f.currency, false),
                        ],
                      ] as Array<[string, string]>,
                  ),
                ]}
              />
              <h4
                className="mb-2 mt-4 text-xs uppercase tracking-wider"
                style={{ ...MONO, color: CK.cyan }}
              >
                {t("financeConsole.recent")}
              </h4>
              {r.recent.length ? (
                <ul className="space-y-1 text-sm">
                  {r.recent.map((tx) => (
                    <li
                      key={tx.id}
                      className="flex justify-between gap-3 text-white/90"
                    >
                      <span className="min-w-0 truncate">
                        <span className="mr-2 tabular-nums text-white/50">
                          {dateFmt.format(new Date(tx.createdAt))}
                        </span>
                        {tx.description}
                      </span>
                      <span
                        className="shrink-0 tabular-nums"
                        style={{ color: tx.amount >= 0 ? CK.green : CK.white }}
                      >
                        {formatMoney(locale, tx.amount, tx.currency, false)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/60">{t("console.empty")}</p>
              )}
            </section>
          ) : (
            <ConsoleInop
              title={t("connect.providers.revolut.name")}
              reason={
                revolut.status === "inop" ? reasonText(t, revolut.reason) : ""
              }
            />
          )}
        </div>
      </ConsoleOverlay>
    </>
  );
}

function Rows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-white/70">{label}</dt>
          <dd className="tabular-nums text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
