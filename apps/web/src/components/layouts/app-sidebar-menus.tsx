"use client";
import { SidebarMenuAction, SidebarMenuButton, useSidebar } from "ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { SidebarMenu, SidebarMenuItem } from "ui/sidebar";
import { SidebarGroupContent } from "ui/sidebar";

import { requireCredits } from "@/lib/billing/require-credits";
import { SidebarGroup } from "ui/sidebar";
import Link from "next/link";
import { getShortcutKeyList, Shortcuts } from "lib/keyboard-shortcuts";
import { useTranslations } from "next-intl";
import { MCPIcon } from "ui/mcp-icon";
import { WriteIcon } from "ui/write-icon";
import { FolderSearchIcon, PlusIcon, Waypoints } from "lucide-react";
import { useState } from "react";
import { ProjectDialog } from "../projects/project-dialog";
import { useStartNewChat } from "@/hooks/use-start-new-chat";
import { getIsUserAdmin } from "lib/user/utils";
import { BasicUser } from "app-types/user";
import { AppSidebarAdmin } from "./app-sidebar-menu-admin";

export function AppSidebarMenus({ user }: { user?: BasicUser }) {
  const startNewChat = useStartNewChat();
  const t = useTranslations("");
  const { setOpenMobile } = useSidebar();
  const [addProjectDialogOpen, setAddProjectDialogOpen] = useState(false);

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem className="mb-1">
              <Link
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  setOpenMobile(false);
                  startNewChat();
                }}
              >
                <SidebarMenuButton className="flex font-semibold group/new-chat bg-input/20 border border-border/40">
                  <WriteIcon className="size-4" />
                  {t("Layout.newChat")}
                  <div className="flex items-center gap-1 text-xs font-medium ml-auto opacity-0 group-hover/new-chat:opacity-100 transition-opacity">
                    {getShortcutKeyList(Shortcuts.openNewChat).map((key) => (
                      <span
                        key={key}
                        className="border w-5 h-5 flex items-center justify-center bg-accent rounded"
                      >
                        {key}
                      </span>
                    ))}
                  </div>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem>
              <Link href="/mcp">
                <SidebarMenuButton className="font-semibold">
                  <MCPIcon className="size-4 fill-accent-foreground" />
                  {t("Layout.mcpConfiguration")}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
        <SidebarMenu>
          <Tooltip>
            <SidebarMenuItem>
              <Link href="/workflow">
                <SidebarMenuButton className="font-semibold">
                  <Waypoints className="size-4" />
                  {t("Layout.workflow")}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
        {getIsUserAdmin(user) && <AppSidebarAdmin />}
        <SidebarMenu className="group/project">
          <Tooltip>
            <SidebarMenuItem>
              <Link href="/projects" onClick={() => setOpenMobile(false)}>
                <SidebarMenuButton className="font-semibold">
                  <FolderSearchIcon className="size-4" />
                  Projects
                </SidebarMenuButton>
              </Link>
              <SidebarMenuAction
                className="group-hover/project:opacity-100 opacity-0 transition-opacity"
                onClick={() => {
                  // Controlled trigger: it bypasses ProjectDialog's own opener,
                  // so the gate has to be repeated here.
                  if (!requireCredits()) return;
                  setAddProjectDialogOpen(true);
                }}
              >
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PlusIcon className="size-4" />
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center">
                    New project
                  </TooltipContent>
                </Tooltip>
              </SidebarMenuAction>
            </SidebarMenuItem>
          </Tooltip>
        </SidebarMenu>
      </SidebarGroupContent>
      <ProjectDialog
        open={addProjectDialogOpen}
        onOpenChange={setAddProjectDialogOpen}
      >
        <span />
      </ProjectDialog>
    </SidebarGroup>
  );
}
