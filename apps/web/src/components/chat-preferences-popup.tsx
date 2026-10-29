"use client";

import { useEffect, useMemo, useState } from "react";
import { AutoHeight } from "ui/auto-height";

import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { isShortcutEvent, Shortcuts } from "lib/keyboard-shortcuts";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerPortal,
  DrawerTitle,
} from "ui/drawer";
import {
  MCPInstructionsContent,
  UserInstructionsContent,
  ExportsManagementContent,
} from "./chat-preferences-content";
import { NotificationSettingsContent } from "./agent-alerts/notification-settings-content";
import { UserIcon, X, Share2, Bell } from "lucide-react";
import { Button } from "ui/button";
import { useTranslations } from "next-intl";
import { MCPIcon } from "ui/mcp-icon";
import { useIsMobile } from "@/hooks/use-mobile";

export function ChatPreferencesPopup() {
  const [openChatPreferences, appStoreMutate] = appStore(
    useShallow((state) => [state.openChatPreferences, state.mutate]),
  );

  const t = useTranslations();
  const isMobile = useIsMobile();

  const tabs = useMemo(() => {
    return [
      {
        label: t("Chat.ChatPreferences.userInstructions"),
        icon: <UserIcon className="w-4 h-4" />,
      },
      {
        label: t("Chat.ChatPreferences.mcpInstructions"),
        icon: <MCPIcon className="w-4 h-4 fill-muted-foreground" />,
      },
      {
        label: t("Chat.ChatPreferences.myExports"),
        icon: <Share2 className="w-4 h-4" />,
      },
      {
        label: t("Chat.ChatPreferences.notificationSettings.title"),
        icon: <Bell className="w-4 h-4" />,
      },
    ];
  }, [t]);

  const [tab, setTab] = useState(0);

  const handleClose = () => {
    appStoreMutate({ openChatPreferences: false });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isChatPreferencesEvent = isShortcutEvent(
        e,
        Shortcuts.openChatPreferences,
      );
      if (isChatPreferencesEvent) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate((prev) => ({
          openChatPreferences: !prev.openChatPreferences,
        }));
      }

      // ESC key to close
      if (e.key === "Escape" && openChatPreferences) {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openChatPreferences]);

  useEffect(() => {
    if (!openChatPreferences) setTab(0);
  }, [openChatPreferences]);

  return (
    <Drawer
      handleOnly
      open={openChatPreferences}
      direction="top"
      onOpenChange={(open) => appStoreMutate({ openChatPreferences: open })}
    >
      <DrawerPortal>
        <DrawerContent
          style={{
            userSelect: "text",
          }}
          className="max-h-[100vh]! w-full h-full border-none rounded-none flex flex-col bg-card overflow-hidden p-4 md:p-6"
        >
          <div className="flex items-center justify-end">
            <Button variant="ghost" size="icon" onClick={handleClose}>
              <X />
            </Button>
          </div>
          <DrawerTitle className="sr-only">Chat Preferences</DrawerTitle>
          <DrawerDescription className="sr-only" />

          <div className="flex justify-center">
            <div className="w-full mt-4 lg:w-5xl lg:mt-14">
              {/* Mobile: Tabs as horizontal scroll */}
              {isMobile && (
                <div>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {tabs.map((tabItem, index) => (
                      <button
                        key={index}
                        onClick={() => setTab(index)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                          tab === index
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/50 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tabItem.icon}
                        <span>{tabItem.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-1 overflow-hidden">
                {/* Desktop: Sidebar */}
                {!isMobile && (
                  <div className="w-64">
                    <nav className="px-4 flex flex-col gap-2">
                      {tabs.map((tabItem, index) => (
                        <button
                          key={index}
                          onClick={() => setTab(index)}
                          className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200 ${
                            tab === index
                              ? "bg-primary text-primary-foreground shadow-md"
                              : "hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {tabItem.icon}
                          <span className="font-medium">{tabItem.label}</span>
                        </button>
                      ))}
                    </nav>
                  </div>
                )}

                {/* Content */}
                <AutoHeight className="flex-1 rounded-lg border max-h-[80vh] overflow-y-auto">
                  <div className="p-4 md:p-8">
                    {openChatPreferences && (
                      <>
                        {tab == 0 ? (
                          <UserInstructionsContent />
                        ) : tab == 1 ? (
                          <MCPInstructionsContent />
                        ) : tab == 2 ? (
                          <ExportsManagementContent />
                        ) : tab == 3 ? (
                          <NotificationSettingsContent />
                        ) : null}
                      </>
                    )}
                  </div>
                </AutoHeight>
              </div>
            </div>
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
