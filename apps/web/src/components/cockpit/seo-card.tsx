"use client";

import { useTranslations } from "next-intl";
import { reasonText } from "lib/cockpit/reasons";
import type { Feed, SeoSummary } from "lib/cockpit/types";
import { cn } from "lib/utils";
import { GLASS, Kpi } from "./console-overlay";
import { CK, MONO } from "./instruments";

/** SEO tab of the MARKETING console: domain overview + top keywords. */
export function SeoCard({
  seo,
  format,
}: {
  seo: Feed<SeoSummary>;
  format: Intl.NumberFormat;
}) {
  const t = useTranslations("Cockpit");
  const s = seo.status === "live" ? seo.data : null;
  const n = (v: number | null) => (v === null ? "---" : format.format(v));

  return (
    <section className={cn(GLASS, "flex flex-col p-3 md:col-span-2 md:p-4")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          role="tablist"
          className="flex gap-1 rounded-xl bg-white/5 p-1 ring-1 ring-white/10"
        >
          <span
            role="tab"
            aria-selected
            className="rounded-lg bg-white/15 px-2.5 py-1 text-sm font-medium text-white"
          >
            {t("seo.tab")}
          </span>
        </div>
        {s && (
          <span className="text-sm text-white/70" style={MONO}>
            {s.domain}
          </span>
        )}
      </div>
      {s ? (
        <div className="grid gap-4 md:grid-cols-[auto_1fr]">
          <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
            <Kpi
              label={t("seo.organicTraffic")}
              value={n(s.organicTraffic)}
              tone={CK.green}
            />
            <Kpi label={t("seo.keywords")} value={n(s.keywordsCount)} />
            <Kpi
              label={t("seo.referringDomains")}
              value={n(s.referringDomains)}
              tone={CK.cyan}
            />
          </div>
          <div>
            <div
              className="mb-2 text-xs uppercase tracking-wider"
              style={{ ...MONO, color: CK.cyan }}
            >
              {t("seo.topKeywords")}
            </div>
            {s.topKeywords.length ? (
              <table className="w-full text-sm text-white">
                <thead>
                  <tr className="text-left text-xs text-white/60">
                    <th className="pb-1 font-normal" />
                    <th className="pb-1 text-right font-normal">
                      {t("seo.position")}
                    </th>
                    <th className="pb-1 text-right font-normal">
                      {t("seo.volume")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.topKeywords.map((k) => {
                    const delta =
                      k.position !== null && k.previousPosition !== null
                        ? k.previousPosition - k.position
                        : null;
                    return (
                      <tr key={k.keyword} className="border-t border-white/10">
                        <td className="max-w-0 truncate py-1 pr-2">
                          {k.keyword}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {k.position ?? "---"}
                          {delta ? (
                            <span
                              className="ml-1 text-xs"
                              style={{ color: delta > 0 ? CK.green : CK.amber }}
                            >
                              {delta > 0 ? "▲" : "▼"}
                              {Math.abs(delta)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1 text-right tabular-nums">
                          {n(k.volume)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-white/60">{t("seo.noKeywords")}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-32 flex-col items-center justify-center gap-1 text-center">
          <span className="tracking-wider" style={{ ...MONO, color: CK.amber }}>
            {t("seo.inopTitle")}
          </span>
          <span className="text-sm text-white/60">
            {seo.status === "inop" ? reasonText(t, seo.reason) : ""}
          </span>
        </div>
      )}
    </section>
  );
}
