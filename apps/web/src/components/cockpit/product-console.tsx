"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { intlLocale } from "lib/cockpit/format";
import { reasonText } from "lib/cockpit/reasons";
import type { Feed, SuperlogSummary } from "lib/cockpit/types";
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

const SEVERITY_COLOR: Record<string, string> = {
  "SEV-1": CK.red,
  "SEV-2": CK.amber,
  "SEV-3": CK.cyan,
};

/** PRODUCT overhead pushbutton: Superlog incidents and per-service errors. */
export function ProductConsole({
  superlog,
  connected,
}: {
  superlog: Feed<SuperlogSummary>;
  connected: boolean;
}) {
  const t = useTranslations("Cockpit");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const live = superlog.status === "live" ? superlog.data : null;
  const state =
    live && (live.openIncidents > 0 || live.firingAlerts > 0)
      ? "fault"
      : feedButtonState(superlog.status, connected);
  const dateTime = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  return (
    <>
      <ConsolePushbutton
        label={t("overhead.product.label")}
        detail={t("overhead.product.detail")}
        state={state}
        stateLabel={t(`status.${state}`)}
        actionLabel={t("productConsole.openHint")}
        open={open}
        onOpenChange={setOpen}
      />
      <ConsoleOverlay
        open={open}
        onOpenChange={setOpen}
        title={t("productConsole.title")}
        closeLabel={t("console.close")}
        kpis={
          live && (
            <>
              <Kpi
                label={t("engines.openIncidents")}
                value={String(live.openIncidents)}
                tone={live.openIncidents ? CK.amber : CK.green}
              />
              <Kpi
                label={t("engines.firingAlerts")}
                value={String(live.firingAlerts)}
                tone={live.firingAlerts ? CK.red : CK.green}
              />
              <Kpi
                label={t("engines.errors24h")}
                value={live.errors24h === null ? "---" : String(live.errors24h)}
              />
            </>
          )
        }
      >
        {live ? (
          <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
            <section className={cn(GLASS, "p-4")}>
              <h3
                className="mb-3 text-xs uppercase tracking-wider"
                style={{ ...MONO, color: CK.cyan }}
              >
                {t("productConsole.incidents")}
              </h3>
              {live.incidents.length ? (
                <ul className="divide-y divide-white/10">
                  {live.incidents.map((incident) => (
                    <li
                      key={incident.id}
                      className="flex flex-col gap-0.5 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                          style={{
                            ...MONO,
                            color:
                              SEVERITY_COLOR[incident.severity ?? ""] ?? CK.dim,
                            boxShadow: `inset 0 0 0 1px ${SEVERITY_COLOR[incident.severity ?? ""] ?? CK.dim}66`,
                          }}
                        >
                          {incident.severity ?? "SEV-?"}
                        </span>
                        <span className="min-w-0 truncate text-sm text-white">
                          {incident.title}
                        </span>
                      </div>
                      <div className="text-xs text-white/60" style={MONO}>
                        {incident.service ?? ""}
                        {incident.startedAt &&
                          ` · ${dateTime.format(new Date(incident.startedAt))}`}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-white/60">
                  {t("productConsole.noIncidents")}
                </p>
              )}
            </section>
            <section className={cn(GLASS, "p-4")}>
              <h3
                className="mb-3 text-xs uppercase tracking-wider"
                style={{ ...MONO, color: CK.cyan }}
              >
                {t("productConsole.services")}
              </h3>
              {live.services.length ? (
                <dl className="space-y-1.5 text-sm">
                  {live.services.map((svc) => (
                    <div key={svc.name} className="flex justify-between gap-3">
                      <dt className="min-w-0 truncate text-white/80">
                        {svc.name}
                      </dt>
                      <dd className="shrink-0 tabular-nums text-white">
                        {svc.openIncidents} · {svc.errors24h}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-sm text-white/60">{t("console.empty")}</p>
              )}
              <p className="mt-3 text-[11px] text-white/50">
                {t("productConsole.servicesLegend")}
              </p>
            </section>
          </div>
        ) : (
          <ConsoleInop
            title={t("productConsole.inopTitle")}
            reason={
              superlog.status === "inop" ? reasonText(t, superlog.reason) : ""
            }
          />
        )}
      </ConsoleOverlay>
    </>
  );
}
