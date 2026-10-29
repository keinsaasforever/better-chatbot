"use client";

import {
  AudioWaveformIcon,
  ChevronDown,
  MessageCircleDashed,
  PanelLeft,
} from "lucide-react";
import { Button } from "ui/button";
import { Separator } from "ui/separator";
import { useSidebar } from "ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

import { appStore } from "@/app/store";
import { BackButton } from "@/components/layouts/back-button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { requireCredits } from "@/lib/billing/require-credits";
import { buildReturnUrl } from "lib/admin/navigation-utils";
import { Shortcuts, getShortcutKeyList } from "lib/keyboard-shortcuts";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { TextShimmer } from "ui/text-shimmer";
import { useShallow } from "zustand/shallow";
import { ThreadDropdown } from "../thread-dropdown";

export function AppHeader() {
  const t = useTranslations();
  const [appStoreMutate] = appStore(useShallow((state) => [state.mutate]));
  const { toggleSidebar, open } = useSidebar();
  const currentPaths = usePathname();
  const searchParams = useSearchParams();

  const showActionButtons = useMemo(() => {
    if (currentPaths.startsWith("/admin")) {
      return false;
    }
    return true;
  }, [currentPaths]);

  const componentByPage = useMemo(() => {
    if (currentPaths.startsWith("/chat/")) {
      return <ThreadDropdownComponent />;
    }
    if (
      currentPaths.startsWith("/admin/users/") &&
      currentPaths.split("/").length > 3
    ) {
      const searchPageParams = searchParams.get("searchPageParams");
      const returnUrl = buildReturnUrl("/admin/users", searchPageParams || "");
      return (
        <BackButton
          data-testid="admin-users-back-button"
          returnUrl={returnUrl}
          title={t("Admin.Users.backToUsers")}
        />
      );
    }
  }, [currentPaths, searchParams]);

  return (
    // Deliberately NOT sticky: this is a flex row in a non-scrolling column, so
    // its nearest scrollport is the document. On mobile, any document pan (iOS
    // keyboard, URL-bar collapse) re-pinned a sticky header and slid it down
    // over the chat, and the translucent background let the message show
    // through. Static + opaque makes the header row a hard cut.
    <header className="z-50 shrink-0 flex items-center px-3 py-2 bg-background">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle Sidebar"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleSidebar();
            }}
            data-testid="sidebar-toggle"
            data-state={open ? "open" : "closed"}
          >
            <PanelLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent align="start" side="bottom">
          <div className="flex items-center gap-2">
            {t("KeyboardShortcuts.toggleSidebar")}
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              {getShortcutKeyList(Shortcuts.toggleSidebar).map((key) => (
                <span
                  key={key}
                  className="w-5 h-5 flex items-center justify-center bg-muted rounded "
                >
                  {key}
                </span>
              ))}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>

      {componentByPage}
      <div className="flex-1" />
      {showActionButtons && (
        <div className="flex items-center gap-2">
          <NotificationBell />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size={"icon"}
                variant={"ghost"}
                className="bg-secondary/40"
                onClick={() => {
                  if (!requireCredits()) return;
                  appStoreMutate((state) => ({
                    voiceChat: {
                      ...state.voiceChat,
                      isOpen: true,
                      agentId: undefined,
                    },
                  }));
                }}
              >
                <AudioWaveformIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent align="end" side="bottom">
              <div className="text-xs flex items-center gap-2">
                {t("KeyboardShortcuts.toggleVoiceChat")}
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  {getShortcutKeyList(Shortcuts.toggleVoiceChat).map((key) => (
                    <span
                      className="w-5 h-5 flex items-center justify-center bg-muted rounded "
                      key={key}
                    >
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size={"icon"}
                variant={"secondary"}
                className="bg-secondary/40"
                onClick={() => {
                  appStoreMutate((state) => ({
                    temporaryChat: {
                      ...state.temporaryChat,
                      isOpen: !state.temporaryChat.isOpen,
                    },
                  }));
                }}
              >
                <MessageCircleDashed className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent align="end" side="bottom">
              <div className="text-xs flex items-center gap-2">
                {t("KeyboardShortcuts.toggleTemporaryChat")}
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  {getShortcutKeyList(Shortcuts.toggleTemporaryChat).map(
                    (key) => (
                      <span
                        className="w-5 h-5 flex items-center justify-center bg-muted rounded "
                        key={key}
                      >
                        {key}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </header>
  );
}

function ThreadDropdownComponent() {
  const t = useTranslations("Layout");
  const [threadList, currentThreadId, generatingTitleThreadIds] = appStore(
    useShallow((state) => [
      state.threadList,
      state.currentThreadId,
      state.generatingTitleThreadIds,
    ]),
  );
  const currentThread = useMemo(() => {
    return threadList.find((thread) => thread.id === currentThreadId);
  }, [threadList, currentThreadId]);

  useEffect(() => {
    if (currentThread?.id) {
      document.title = currentThread.title || t("newChat");
    }
  }, [currentThread?.id, currentThread?.title, t]);

  if (!currentThread) return null;

  return (
    <div className="items-center gap-1 hidden md:flex">
      <div className="w-1 h-4">
        <Separator orientation="vertical" />
      </div>

      <ThreadDropdown
        threadId={currentThread.id}
        beforeTitle={currentThread.title}
      >
        <div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="data-[state=open]:bg-input! hover:text-foreground cursor-pointer flex gap-1 items-center px-2 py-1 rounded-md hover:bg-accent"
              >
                {generatingTitleThreadIds.includes(currentThread.id) ? (
                  <TextShimmer className="truncate max-w-60 min-w-0 mr-1">
                    {currentThread.title || t("newChat")}
                  </TextShimmer>
                ) : (
                  <p className="truncate max-w-60 min-w-0 mr-1">
                    {currentThread.title || t("newChat")}
                  </p>
                )}

                <ChevronDown size={14} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[200px] p-4 break-all overflow-y-auto max-h-[200px]">
              {currentThread.title || t("newChat")}
            </TooltipContent>
          </Tooltip>
        </div>
      </ThreadDropdown>
    </div>
  );
}
