"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "lib/utils";
import { CK, MONO, Pushbutton } from "./instruments";

/**
 * Glass console that an overhead pushbutton opens over the windshield.
 * Built on the Radix dialog (focus trap, Escape, aria-modal) with the
 * cockpit's own glass styling instead of the app's dialog card.
 */

export const GLASS =
  "rounded-2xl bg-[rgba(16,24,36,0.42)] ring-1 ring-white/15 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_20px_60px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.14)]";

export type PushbuttonState = "on" | "fault" | "off";

export function ConsolePushbutton({
  label,
  detail,
  state,
  stateLabel,
  actionLabel,
  open,
  onOpenChange,
}: {
  label: string;
  detail: string;
  state: PushbuttonState;
  stateLabel: string;
  actionLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Pushbutton
      label={label}
      detail={detail}
      state={state}
      stateLabel={stateLabel}
      actionLabel={actionLabel}
      expanded={open}
      onClick={() => {
        // Bring the windshield into view first so the glass sits in front of it.
        document
          .getElementById("cockpit-windshield")
          ?.scrollIntoView({ block: "start" });
        onOpenChange(true);
      }}
    />
  );
}

export function ConsoleOverlay({
  open,
  onOpenChange,
  title,
  subtitle,
  closeLabel,
  kpis,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  closeLabel: string;
  kpis?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#020611]/30 backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 overflow-y-auto focus:outline-none"
          onClick={(e) => {
            // A click on the empty area around the glass closes the console.
            if (e.target === e.currentTarget) onOpenChange(false);
          }}
        >
          <div
            className="relative mx-auto max-w-[1200px] px-4 pb-10 pt-6 md:px-6 md:pt-10"
            onClick={(e) => {
              if (e.target === e.currentTarget) onOpenChange(false);
            }}
          >
            <header
              className={cn(
                GLASS,
                "mb-4 flex items-start justify-between gap-3 px-4 py-3 md:items-center md:px-5",
              )}
            >
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                <DialogPrimitive.Title
                  className="text-2xl md:text-3xl"
                  style={{ color: CK.white }}
                >
                  {title}
                </DialogPrimitive.Title>
                {subtitle && (
                  <span
                    className="text-xs tracking-wider"
                    style={{ ...MONO, color: CK.backlight }}
                  >
                    {subtitle}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 md:gap-3">
                {kpis}
                <DialogPrimitive.Close
                  aria-label={closeLabel}
                  className="ml-1 inline-flex size-9 items-center justify-center rounded-lg bg-white/10 text-white ring-1 ring-white/15 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4fd8ff]"
                >
                  <X size={18} strokeWidth={2.25} />
                </DialogPrimitive.Close>
              </div>
            </header>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Kpi({
  label,
  value,
  tone = CK.white,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg bg-white/5 px-2.5 py-1 ring-1 ring-white/10">
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ ...MONO, color: CK.cyan }}
      >
        {label}
      </div>
      <div className="text-base tabular-nums" style={{ ...MONO, color: tone }}>
        {value}
      </div>
    </div>
  );
}

/** Centered amber INOP message inside a glass card. */
export function ConsoleInop({
  title,
  reason,
}: { title: string; reason: string }) {
  return (
    <div
      className={cn(
        GLASS,
        "flex min-h-60 flex-col items-center justify-center gap-2 p-6 text-center",
      )}
    >
      <span
        className="text-2xl tracking-wider"
        style={{ ...MONO, color: CK.amber }}
      >
        {title}
      </span>
      <span className="max-w-xl text-sm" style={{ ...MONO, color: "#c3ccd6" }}>
        {reason}
      </span>
    </div>
  );
}

/** Translates a feed's live/connected state into the pushbutton annunciator. */
export function feedButtonState(
  status: "live" | "inop",
  connected: boolean,
): PushbuttonState {
  if (status === "live") return "on";
  return connected ? "fault" : "off";
}
