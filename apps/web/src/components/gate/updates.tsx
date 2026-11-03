"use client";

import { RefreshCw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { Button } from "ui/button";
import { fetcher } from "lib/utils";

/**
 * Turning on update checks for this copy (see lib/updates/workflow.ts). The
 * server hands the administrator a link to GitHub's pre-filled new-file page;
 * everyone else, and any deployment not on Vercel with GitHub, gets null.
 */
export function useUpdateSetupUrl(): string | null {
  const { data } = useSWR<{ url: string | null }>(
    "/api/updates/setup",
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  return data?.url ?? null;
}

const DISMISSED_KEY = "better-chatbot:updates-notice-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // Private mode or blocked storage: the notice simply comes back.
  }
}

/** A one-time card for the administrator. The menu keeps the link after. */
export function UpdatesNotice() {
  const t = useTranslations("Updates");
  const url = useUpdateSetupUrl();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(readDismissed()), []);

  if (!url || dismissed) return null;
  const close = () => {
    writeDismissed();
    setDismissed(true);
  };

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-[min(360px,calc(100vw-2rem))] rounded-xl border bg-background p-4 shadow-lg"
      data-testid="updates-notice"
    >
      <div className="flex items-start gap-3">
        <RefreshCw className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <button
          type="button"
          aria-label={t("later")}
          className="text-muted-foreground hover:text-foreground"
          onClick={close}
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={close}>
          {t("later")}
        </Button>
        <Button size="sm" asChild>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={close}
          >
            {t("turnOn")}
          </a>
        </Button>
      </div>
    </div>
  );
}
