"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCockpitUpdates } from "@/hooks/queries/use-cockpit-updates";
import { intlLocale } from "lib/cockpit/format";
import {
  type CockpitUpdateSeverity,
  parseCockpitUpdateSeverity,
} from "lib/cockpit/updates";
import { CK, McduFrame } from "./instruments";

const SEVERITY_COLOR: Record<CockpitUpdateSeverity, string> = {
  info: CK.cyan,
  warn: CK.amber,
  alert: CK.red,
};

/**
 * Bottom-right MCDU: the live UPDATES feed (server alerts and updates the
 * voice agent posts). Each row has a severity LED and a Europe/Berlin time;
 * clicking marks it read and follows its link.
 */
export function CockpitUpdates() {
  const t = useTranslations("Cockpit");
  const locale = useLocale();
  const router = useRouter();
  const { updates, isLoading, markRead } = useCockpitUpdates();
  const time = new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });

  return (
    <McduFrame title={t("mcdu.updates.title")}>
      {!isLoading && updates.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: CK.amber }}>
          {t("updates.empty")}
        </p>
      ) : (
        <ol className="space-y-1 text-xs" aria-live="polite">
          {updates.map((row) => {
            // Severity rides on the type suffix; title and body are plain
            // text, so the row reads the same here as in the header bell.
            const severity = parseCockpitUpdateSeverity(row.type) ?? "info";
            const line = row.body ? `${row.title} · ${row.body}` : row.title;
            return (
              <li key={row.id}>
                <button
                  type="button"
                  title={line}
                  onClick={() => {
                    void markRead(row.id);
                    if (row.url && row.url !== "/cockpit") router.push(row.url);
                  }}
                  className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#4fd8ff]"
                  style={{ color: row.readAt ? CK.dim : CK.green }}
                >
                  <span
                    aria-label={t(`updates.severity.${severity}`)}
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: SEVERITY_COLOR[severity],
                      boxShadow: row.readAt
                        ? "none"
                        : `0 0 6px ${SEVERITY_COLOR[severity]}`,
                    }}
                  />
                  <span
                    className="shrink-0 tabular-nums"
                    style={{ color: CK.dim }}
                  >
                    {time.format(new Date(row.createdAt))}
                  </span>
                  <span className="truncate">{row.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </McduFrame>
  );
}
