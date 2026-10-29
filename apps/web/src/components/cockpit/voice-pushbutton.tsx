"use client";

import { useTranslations } from "next-intl";
import { appStore } from "@/app/store";
import { requireCredits } from "@/lib/billing/require-credits";
import { cn } from "lib/utils";
import {
  useVoiceLiveStatus,
  type VoiceLiveStatus,
} from "lib/voice/voice-live-status";
import { CK, MONO } from "./instruments";

export type ComLed =
  | "off"
  | "standby"
  | "connecting"
  | "connected"
  | "speaking";

/** LED state from the drawer's open flag and the live session status. */
export function comLed(open: boolean, live: VoiceLiveStatus): ComLed {
  if (!open) return "off";
  if (live.phase === "connected") {
    return live.userSpeaking ? "speaking" : "connected";
  }
  return live.phase === "connecting" ? "connecting" : "standby";
}

const LED_COLOR: Record<ComLed, string> = {
  off: "#3a4047",
  standby: CK.amber,
  connecting: CK.amber,
  connected: CK.green,
  speaking: CK.white,
};

/**
 * COM 1 · PTT: the cockpit's radio key. Opens the floating voice orb with the
 * flight-deck copilot prompt (`context: "cockpit"`, see `ChatBotVoice`); the
 * orb connects by itself and the copilot greets first. A plain key, not
 * hold-to-talk: the session hangs up from the orb's X.
 */
export function VoicePushbutton() {
  const t = useTranslations("Cockpit.com");
  const open = appStore((state) => state.voiceChat.isOpen);
  const live = useVoiceLiveStatus();
  const led = comLed(open, live);
  const color = LED_COLOR[led];
  const stateLabel = t(`state.${led}`);

  return (
    <button
      type="button"
      data-led={led}
      aria-label={`${t("action")} (${t("label")}: ${stateLabel})`}
      title={`${t("action")} · ${stateLabel}`}
      onClick={() => {
        if (open || !requireCredits()) return;
        appStore.setState((state) => ({
          voiceChat: {
            ...state.voiceChat,
            isOpen: true,
            agentId: undefined,
            context: "cockpit",
          },
        }));
      }}
      className="flex shrink-0 cursor-pointer items-center gap-2 rounded-md bg-gradient-to-b from-[#2b3037] to-[#15181c] px-2.5 py-1.5 shadow-[0_4px_10px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.08)] ring-1 ring-black transition-transform hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4fd8ff] active:translate-y-px"
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-5 rounded-full",
          led === "speaking" && "motion-safe:animate-pulse",
        )}
        style={{
          backgroundColor: color,
          boxShadow: led === "off" ? "none" : `0 0 10px ${color}`,
        }}
      />
      <span className="flex flex-col items-start gap-0.5 leading-none">
        <span
          className="text-[10px] tracking-wider"
          style={{ ...MONO, color: CK.backlight }}
        >
          {t("label")}
        </span>
        <span
          className="text-[10px] tracking-wider"
          style={{ ...MONO, color: CK.dim }}
        >
          {t("detail")}
        </span>
      </span>
    </button>
  );
}
