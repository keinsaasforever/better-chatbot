"use client";

import {
  isVoiceBrowserFrameFinal,
  type VoiceBrowserFrame,
} from "lib/voice/browser-run-contract";
import { Loader, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

/**
 * The Kernel live view, inside the voice drawer.
 *
 * Mirrors `BrowserPanelContent` in the artifact panel rather than reusing it:
 * that one is driven by `ArtifactPanelContext`, which is keyed on a `ToolUIPart`
 * and mounted inside `chat-bot.tsx`. The voice drawer renders from
 * `app-popup-provider.tsx`, outside that tree, and a voice run has no tool part
 * — so the two surfaces share the wire contract, not the component.
 *
 * The live view is VIEW-ONLY here. Kernel's live view is interactive by
 * default; `toReadOnlyLiveViewUrl` is applied server-side in `browser-run.ts`,
 * so the interactive URL never reaches this component at all.
 */
export function VoiceBrowserPreview({
  frame,
  onDismiss,
}: {
  frame: VoiceBrowserFrame;
  onDismiss: () => void;
}) {
  const t = useTranslations("Chat.Browser");
  const tVoice = useTranslations("Chat.VoiceChat.Browser");

  const liveViewUrl = "liveViewUrl" in frame ? frame.liveViewUrl : undefined;
  const isFinished = isVoiceBrowserFrameFinal(frame);

  // Inline rather than a helper taking `t`: next-intl's translator is not a
  // plain `(key: string) => string`, and narrowing it at a parameter is the
  // kind of thing that only fails once it reaches CI.
  let statusLabel: string;
  switch (frame.status) {
    case "starting":
      statusLabel = t("statusStarting");
      break;
    case "running":
      statusLabel =
        frame.stepCount > 0
          ? tVoice("steps", { count: frame.stepCount })
          : t("statusRunning");
      break;
    case "done":
      statusLabel = t("statusDone");
      break;
    case "blocked":
      statusLabel = t("statusBlocked");
      break;
    default:
      statusLabel = t("statusFailed");
  }

  return (
    <div className="flex flex-col h-full min-h-0 border rounded-lg overflow-hidden bg-card">
      <div className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
        <span className="text-sm font-medium">{tVoice("title")}</span>
        <span className="text-xs text-muted-foreground truncate">
          {statusLabel}
        </span>
        {isFinished && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-7"
                onClick={onDismiss}
              >
                <XIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tVoice("hide")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {frame.status === "blocked" && (
        <div className="px-3 py-2 border-b bg-amber-500/10 text-xs shrink-0">
          <p className="font-medium">{t("blockedTitle")}</p>
          <p className="text-muted-foreground mt-0.5">
            {frame.reason || t("blockedFallbackReason")}
          </p>
          <p className="text-muted-foreground mt-1">{t("blockedHint")}</p>
        </div>
      )}

      {frame.status === "failed" && (
        <div className="px-3 py-2 border-b bg-destructive/10 text-xs shrink-0">
          <p className="font-medium">{t("couldNotStartTitle")}</p>
          <p className="text-muted-foreground mt-0.5">
            {frame.error || t("unknownError")}
          </p>
        </div>
      )}

      {liveViewUrl ? (
        <div className="relative flex-1 min-h-0">
          <iframe
            className="absolute inset-0 w-full h-full border-0"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
            src={liveViewUrl}
            title={tVoice("title")}
          />
          {/*
            Belt and braces to the server-side `readOnly=true`: while the agent
            is working, a stray click inside the frame would fight it for the
            cursor. Lifted once the run ends so the final page can be scrolled
            and read.
          */}
          {!isFinished && (
            <div
              className="absolute inset-0 cursor-not-allowed"
              aria-hidden="true"
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-center justify-center p-8 text-center">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {!isFinished && <Loader className="size-4 animate-spin" />}
            {frame.status === "failed"
              ? frame.error || t("unknownError")
              : t("statusStarting")}
          </div>
        </div>
      )}

      <p className="px-3 py-1.5 border-t text-[11px] text-muted-foreground shrink-0">
        {isFinished ? t("sessionEnded") : tVoice("watchOnly")}
      </p>
    </div>
  );
}
