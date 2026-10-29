"use client";

import { cn } from "@/lib/utils";
import { AlertCircle, DownloadCloud, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "ui/button";

const TOAST_ID = "desktop-update";
const ERROR_TOAST_MS = 15_000;

/** `useTranslations("Desktop.Updates")` shape, injected so the toasts stay hook-free. */
export type UpdateToastTranslate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

type UpdatesBridge = NonNullable<NonNullable<Window["desktop"]>["updates"]>;

/**
 * Desktop builds from 1.27.0 download in the background and expose
 * `restartAndInstall`; older builds wait for "Update now" and restart on their
 * own once the download completes.
 */
function supportsBackgroundDownload(bridge: UpdatesBridge | undefined) {
  return typeof bridge?.restartAndInstall === "function";
}

function Shell({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-card p-3 shadow-lg",
        "ring-1 ring-border/60",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}

const spinner = (
  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
);

export function renderUpdateToast(
  state: DesktopUpdateState,
  t: UpdateToastTranslate,
  bridge: UpdatesBridge | undefined,
): void {
  const persistent = {
    id: TOAST_ID,
    position: "bottom-left" as const,
    duration: Number.POSITIVE_INFINITY,
  };
  const background = supportsBackgroundDownload(bridge);

  switch (state.status) {
    case "available":
      toast.custom(
        () => (
          <Shell
            icon={
              <DownloadCloud className="mt-0.5 size-4 shrink-0 text-primary" />
            }
            title={t("availableTitle")}
            description={
              background
                ? t("availableDescription", { version: state.version })
                : t("legacyAvailableDescription", { version: state.version })
            }
          >
            {!background && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-2 h-7 px-2 text-xs"
                onClick={() => void bridge?.downloadAndInstall()}
              >
                {t("updateNow")}
              </Button>
            )}
          </Shell>
        ),
        persistent,
      );
      return;
    case "downloading":
      toast.custom(
        () => (
          <Shell
            icon={spinner}
            title={t("downloadingTitle", { version: state.version })}
            description={t("downloadingDescription", {
              percent: Math.round(state.percent),
            })}
          />
        ),
        persistent,
      );
      return;
    case "downloaded":
      if (!background) {
        // Older builds quit and install on their own right after this state.
        toast.custom(
          () => (
            <Shell
              icon={spinner}
              title={t("installingTitle")}
              description={t("installingDescription")}
            />
          ),
          persistent,
        );
        return;
      }
      toast.custom(
        () => (
          <Shell
            icon={<RefreshCw className="mt-0.5 size-4 shrink-0 text-primary" />}
            title={t("readyTitle", { version: state.version })}
            description={t("readyDescription")}
          >
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                data-testid="desktop-update-restart"
                onClick={() => void bridge?.restartAndInstall?.()}
              >
                {t("restartNow")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => toast.dismiss(TOAST_ID)}
              >
                {t("later")}
              </Button>
            </div>
          </Shell>
        ),
        persistent,
      );
      return;
    case "error":
      toast.custom(
        () => (
          <Shell
            icon={
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            }
            title={t("failedTitle")}
            description={state.message}
          />
        ),
        { id: TOAST_ID, position: "bottom-left", duration: ERROR_TOAST_MS },
      );
      return;
    case "idle":
    case "checking":
    case "not-available":
      return;
  }
}

/** Listens for Electron auto-updater state and surfaces a bottom-left toast. Desktop app only. */
export function DesktopUpdateNotifier() {
  const t = useTranslations("Desktop.Updates");
  // Read through a ref so a re-render never tears down the IPC subscription.
  const tRef = useRef<UpdateToastTranslate>(t);
  tRef.current = t;

  useEffect(() => {
    const updates = window.desktop?.updates;
    if (!updates) return;

    const render = (state: DesktopUpdateState) =>
      renderUpdateToast(state, tRef.current, updates);
    void updates.getState().then(render);
    return updates.onStateChange(render);
  }, []);

  return null;
}
