"use client";

import {
  deleteThreadsAction,
  deleteUnarchivedThreadsAction,
} from "@/app/api/chat/actions";
import { appStore } from "@/app/store";
import { useMounted } from "@/hooks/use-mounted";
import { fetcher } from "lib/utils";
import { ChevronDown, ChevronUp, MoreHorizontal, Trash } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import useSWR, { mutate } from "swr";
import { Button } from "ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { handleErrorWithToast } from "ui/shared-toast";
import { SidebarGroupLabel, SidebarMenuSub } from "ui/sidebar";
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuSkeleton,
  SidebarMenuSubItem,
} from "ui/sidebar";
import { SidebarGroupContent, SidebarMenu, SidebarMenuItem } from "ui/sidebar";
import { SidebarGroup } from "ui/sidebar";
import { useShallow } from "zustand/shallow";
import { ThreadDropdown } from "../thread-dropdown";

import { ChatThread } from "app-types/chat";
import { deduplicateByKey, groupBy } from "lib/utils";
import { useTranslations } from "next-intl";
import { TextShimmer } from "ui/text-shimmer";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

type ThreadGroup = {
  label: string;
  threads: any[];
};

const MAX_THREADS_COUNT = 40;

export function AppSidebarThreads() {
  const mounted = useMounted();
  const router = useRouter();
  const t = useTranslations("Layout");
  const [storeMutate, currentThreadId, generatingTitleThreadIds, storeThreads] =
    appStore(
      useShallow((state) => [
        state.mutate,
        state.currentThreadId,
        state.generatingTitleThreadIds,
        state.threadList,
      ]),
    );
  // State to track if expanded view is active
  const [isExpanded, setIsExpanded] = useState(false);

  const { data: threadList, isLoading } = useSWR("/api/thread", fetcher, {
    onError: handleErrorWithToast,
    fallbackData: [],
    // Poll only while a thread is running (background/scheduled runs included)
    // so the "working" indicator clears itself; otherwise stay quiet.
    refreshInterval: (data) =>
      Array.isArray(data) && data.some((t) => t.status === "running")
        ? 15_000
        : 0,
    onSuccess: (data) => {
      storeMutate((prev) => {
        const groupById = groupBy(prev.threadList, "id");

        const generatingTitleThreads = prev.generatingTitleThreadIds
          .map((id) => {
            return groupById[id]?.[0];
          })
          .filter(Boolean) as ChatThread[];
        const list = deduplicateByKey(
          generatingTitleThreads.concat(data),
          "id",
        );
        return {
          threadList: list.map((v) => {
            const target = groupById[v.id]?.[0];
            if (!target) return v;
            if (target.title && !v.title)
              return {
                ...v,
                title: target.title,
              };
            return v;
          }),
        };
      });
    },
  });

  // Check if we have 40 or more threads to display "View All" button
  const hasExcessThreads = threadList && threadList.length >= MAX_THREADS_COUNT;

  // A title the store already knows about wins over an empty fetched one: the
  // titling request writes to the store as soon as it lands, and a thread
  // opened with a known title seeds it on mount. Without this the sidebar would
  // keep rendering "New Chat" until the next /api/thread revalidation.
  const titledThreadList = useMemo(() => {
    if (!threadList?.length) return threadList;
    const titleById = new Map(
      storeThreads
        .filter((thread) => thread.title?.trim())
        .map((thread) => [thread.id, thread.title]),
    );
    if (titleById.size === 0) return threadList;
    return threadList.map((thread) =>
      thread.title?.trim()
        ? thread
        : { ...thread, title: titleById.get(thread.id) ?? thread.title },
    );
  }, [threadList, storeThreads]);

  // Use either limited or full thread list based on expanded state
  const displayThreadList = useMemo(() => {
    if (!titledThreadList) return [];
    return !isExpanded && hasExcessThreads
      ? titledThreadList.slice(0, MAX_THREADS_COUNT)
      : titledThreadList;
  }, [titledThreadList, hasExcessThreads, isExpanded]);

  const threadGroupByDate = useMemo(() => {
    if (!displayThreadList || displayThreadList.length === 0) {
      return [];
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const groups: ThreadGroup[] = [
      { label: t("today"), threads: [] },
      { label: t("yesterday"), threads: [] },
      { label: t("lastWeek"), threads: [] },
      { label: t("older"), threads: [] },
    ];

    displayThreadList.forEach((thread) => {
      const threadDate =
        (thread.lastMessageAt
          ? new Date(thread.lastMessageAt)
          : new Date(thread.createdAt)) || new Date();
      threadDate.setHours(0, 0, 0, 0);

      if (threadDate.getTime() === today.getTime()) {
        groups[0].threads.push(thread);
      } else if (threadDate.getTime() === yesterday.getTime()) {
        groups[1].threads.push(thread);
      } else if (threadDate.getTime() >= lastWeek.getTime()) {
        groups[2].threads.push(thread);
      } else {
        groups[3].threads.push(thread);
      }
    });

    // Filter out empty groups
    return groups.filter((group) => group.threads.length > 0);
  }, [displayThreadList]);

  const handleDeleteAllThreads = async () => {
    await toast.promise(deleteThreadsAction(), {
      loading: t("deletingAllChats"),
      success: () => {
        mutate("/api/thread");
        router.push("/");
        return t("allChatsDeleted");
      },
      error: t("failedToDeleteAllChats"),
    });
  };

  const handleDeleteUnarchivedThreads = async () => {
    await toast.promise(deleteUnarchivedThreadsAction(), {
      loading: t("deletingUnarchivedChats"),
      success: () => {
        mutate("/api/thread");
        router.push("/");
        return t("unarchivedChatsDeleted");
      },
      error: t("failedToDeleteUnarchivedChats"),
    });
  };

  if (isLoading || threadList?.length === 0)
    return (
      <SidebarGroup>
        <SidebarGroupContent className="group-data-[collapsible=icon]:hidden group/threads">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarGroupLabel className="">
                <h4 className="text-xs text-muted-foreground">
                  {t("recentChats")}
                </h4>
              </SidebarGroupLabel>

              {isLoading ? (
                Array.from({ length: 12 }).map(
                  (_, index) => mounted && <SidebarMenuSkeleton key={index} />,
                )
              ) : (
                <div className="px-2 py-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("noConversationsYet")}
                  </p>
                </div>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );

  return (
    <>
      {threadGroupByDate.map((group, index) => {
        const isFirst = index === 0;
        return (
          <SidebarGroup key={group.label}>
            <SidebarGroupContent className="group-data-[collapsible=icon]:hidden group/threads">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarGroupLabel className="">
                    <h4 className="text-xs text-muted-foreground group-hover/threads:text-foreground transition-colors">
                      {group.label}
                    </h4>
                    <div className="flex-1" />
                    {isFirst && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="data-[state=open]:bg-input! opacity-0 data-[state=open]:opacity-100! group-hover/threads:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={handleDeleteAllThreads}
                          >
                            <Trash />
                            {t("deleteAllChats")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={handleDeleteUnarchivedThreads}
                          >
                            <Trash />
                            {t("deleteUnarchivedChats")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </SidebarGroupLabel>

                  {group.threads.map((thread) => (
                    <SidebarMenuSub
                      key={thread.id}
                      className={"group/thread mr-0"}
                    >
                      <SidebarMenuSubItem>
                        <ThreadDropdown
                          side="right"
                          threadId={thread.id}
                          beforeTitle={thread.title}
                        >
                          <div className="flex items-center data-[state=open]:bg-input! group-hover/thread:bg-input! rounded-lg">
                            <Tooltip delayDuration={1000}>
                              <TooltipTrigger asChild>
                                <SidebarMenuButton
                                  asChild
                                  className="group-hover/thread:bg-transparent!"
                                  isActive={currentThreadId === thread.id}
                                >
                                  <Link
                                    href={`/chat/${thread.id}`}
                                    className="flex items-center"
                                  >
                                    {thread.status === "running" && (
                                      <span
                                        className="size-2 shrink-0 rounded-full bg-primary animate-pulse"
                                        title="Running"
                                        data-testid="thread-running-indicator"
                                      />
                                    )}
                                    {generatingTitleThreadIds.includes(
                                      thread.id,
                                    ) || thread.status === "running" ? (
                                      <TextShimmer className="truncate min-w-0">
                                        {thread.title || t("newChat")}
                                      </TextShimmer>
                                    ) : (
                                      <p className="truncate min-w-0">
                                        {thread.title || t("newChat")}
                                      </p>
                                    )}
                                  </Link>
                                </SidebarMenuButton>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[200px] p-4 break-all overflow-y-auto max-h-[200px]">
                                {thread.title || t("newChat")}
                              </TooltipContent>
                            </Tooltip>

                            <SidebarMenuAction className="data-[state=open]:bg-input data-[state=open]:opacity-100 opacity-0 group-hover/thread:opacity-100">
                              <MoreHorizontal />
                            </SidebarMenuAction>
                          </div>
                        </ThreadDropdown>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  ))}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        );
      })}

      {hasExcessThreads && (
        <SidebarMenu>
          <SidebarMenuItem>
            {/* TODO: Later implement a dedicated search/all chats page instead of this expand functionality */}
            <div className="w-full flex px-4">
              <Button
                variant="secondary"
                size="sm"
                className="w-full hover:bg-input! justify-start"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                <MoreHorizontal className="mr-2" />
                {isExpanded ? t("showLessChats") : t("showAllChats")}
                {isExpanded ? <ChevronUp /> : <ChevronDown />}
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
    </>
  );
}
