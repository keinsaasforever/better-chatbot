"use client";

import { useGlobalShortcut } from "@/hooks/use-global-shortcut";
import { requireCredits } from "@/lib/billing/require-credits";
import { isNull } from "lib/utils";
import { useEffect } from "react";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import dynamic from "next/dynamic";
import { isShortcutEvent, Shortcuts } from "lib/keyboard-shortcuts";

const VoiceChatSession = dynamic(
  () => import("./chat-bot-voice-session").then((mod) => mod.VoiceChatSession),
  { ssr: false },
);

const VoiceOrb = dynamic(
  () => import("./cockpit/voice-orb/voice-orb").then((mod) => mod.VoiceOrb),
  { ssr: false },
);

/**
 * Lightweight shell: keyboard shortcut + lazy-loaded realtime session.
 * Heavy deps (@ai-sdk/react realtime) load only when voice chat opens.
 */
export function ChatBotVoice() {
  const [isOpen, agentId, context, appStoreMutate] = appStore(
    useShallow((state) => [
      state.voiceChat.isOpen,
      state.voiceChat.agentId,
      state.voiceChat.context,
      state.mutate,
    ]),
  );

  useEffect(() => {
    if (!isOpen && !isNull(agentId)) {
      appStoreMutate((prev) => ({
        voiceChat: {
          ...prev.voiceChat,
          agentId: undefined,
        },
      }));
    }
  }, [isOpen, agentId, appStoreMutate]);

  useGlobalShortcut(
    (e: KeyboardEvent) => {
      if (isOpen) return;
      const isVoiceChatEvent = isShortcutEvent(e, Shortcuts.toggleVoiceChat);
      if (isVoiceChatEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!requireCredits()) return;
        appStoreMutate((prev) => ({
          voiceChat: {
            ...prev.voiceChat,
            isOpen: true,
            agentId: undefined,
          },
        }));
      }
    },
    [isOpen, appStoreMutate],
  );

  if (!isOpen) return null;

  // The cockpit's COM 1 key opens a floating orb, not the full-screen drawer.
  return context === "cockpit" ? <VoiceOrb /> : <VoiceChatSession />;
}
