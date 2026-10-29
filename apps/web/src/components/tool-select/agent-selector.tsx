"use client";

import { useAgents } from "@/hooks/queries/use-agents";
import { AgentSummary } from "app-types/agent";
import { ArrowUpRightIcon, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

export function AgentSelector({
  onSelectAgent,
}: {
  onSelectAgent?: (agent: AgentSummary) => void;
}) {
  const t = useTranslations();
  const { myAgents, bookmarkedAgents } = useAgents({
    filters: ["mine", "bookmarked"],
  });

  const emptyAgent = useMemo(() => {
    if (myAgents.length + bookmarkedAgents.length > 0) return null;
    return (
      <Link
        href={"/agent/new"}
        className="py-8 px-4 hover:bg-input/100 rounded-lg cursor-pointer flex justify-between items-center text-xs overflow-hidden"
      >
        <div className="gap-1 z-10">
          <div className="flex items-center mb-4 gap-1">
            <p className="font-semibold">{t("Layout.createAgent")}</p>
            <ArrowUpRightIcon className="size-3" />
          </div>
          <p className="text-muted-foreground">
            {bookmarkedAgents.length > 0
              ? t("Layout.createYourOwnAgentOrSelectShared")
              : t("Layout.createYourOwnAgent")}
          </p>
        </div>
      </Link>
    );
  }, [myAgents.length, bookmarkedAgents.length, t]);

  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="text-xs flex items-center gap-2 font-semibold cursor-pointer">
          <MessageCircle className="size-3.5" />
          {t("Agent.title")}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="w-[var(--radix-popper-available-width)] relative md:w-80">
            {emptyAgent}

            {/* My Agents */}
            {myAgents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                className="cursor-pointer"
                onClick={() => onSelectAgent?.(agent)}
              >
                {agent.icon && agent.icon.type === "emoji" ? (
                  <div
                    style={{
                      backgroundColor: agent.icon?.style?.backgroundColor,
                    }}
                    className="p-1 rounded flex items-center justify-center ring ring-background border"
                  >
                    <Avatar className="size-3">
                      <AvatarImage src={agent.icon?.value} />
                      <AvatarFallback>{agent.name.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                  </div>
                ) : null}
                <span className="truncate min-w-0">{agent.name}</span>
              </DropdownMenuItem>
            ))}

            {myAgents.length > 0 && bookmarkedAgents.length > 0 && (
              <DropdownMenuSeparator />
            )}

            {bookmarkedAgents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                className="cursor-pointer"
                onClick={() => onSelectAgent?.(agent)}
              >
                {agent.icon && agent.icon.type === "emoji" ? (
                  <div
                    style={{
                      backgroundColor: agent.icon?.style?.backgroundColor,
                    }}
                    className="p-1 rounded flex items-center justify-center ring ring-background border"
                  >
                    <Avatar className="size-3">
                      <AvatarImage src={agent.icon?.value} />
                      <AvatarFallback>{agent.name.slice(0, 1)}</AvatarFallback>
                    </Avatar>
                  </div>
                ) : null}
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="truncate min-w-0">{agent.name}</span>
                  {agent.userName && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Avatar className="size-4 ml-2 shrink-0">
                          <AvatarImage src={agent.userAvatar} />
                          <AvatarFallback className="text-xs text-muted-foreground font-medium">
                            {agent.userName[0]?.toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("Common.sharedBy", { userName: agent.userName })}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}
