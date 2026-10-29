"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChatMention } from "app-types/chat";
import { DefaultToolName } from "lib/ai/tools";
import { cn, noop } from "lib/utils";
import equal from "lib/equal";
import {
  ChevronDownIcon,
  HammerIcon,
  Loader,
  Sparkles,
  XIcon,
} from "lucide-react";
import { ChatMentionInputSuggestion } from "@/components/chat-mention-input";
import { DefaultToolIcon } from "@/components/default-tool-icon";
import { MCPIcon } from "ui/mcp-icon";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";

interface AgentToolSelectorProps {
  mentions: ChatMention[];
  isLoading?: boolean;
  disabled?: boolean;
  hasEditAccess?: boolean;
  onChange: (mentions: ChatMention[]) => void;
}

export function AgentToolSelector({
  mentions,
  isLoading = false,
  disabled = false,
  hasEditAccess = true,
  onChange,
}: AgentToolSelectorProps) {
  const t = useTranslations();
  const triggerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const triggerRect = useMemo(() => {
    return triggerRef.current?.getBoundingClientRect();
  }, [open]);

  const handleSelectMention = useCallback(
    (item: { label: string; id: string }) => {
      const mention = JSON.parse(item.id) as ChatMention;
      const newMentions = [...mentions];
      const index = newMentions.findIndex((m) => equal(m, mention));

      if (index !== -1) {
        newMentions.splice(index, 1);
      } else {
        newMentions.push(mention);
      }

      onChange(newMentions);
    },
    [mentions, onChange],
  );

  const handleDeleteMention = useCallback(
    (mention: ChatMention) => {
      onChange(mentions.filter((m) => !equal(m, mention)));
    },
    [mentions, onChange],
  );

  const selectedIds = useMemo(() => {
    return mentions.map((m) => JSON.stringify(m));
  }, [mentions]);

  const selectedMentions = useMemo(() => {
    return mentions.map((m, i) => (
      <div
        key={i}
        className={cn(
          "text-xs flex items-center gap-1 px-2 py-1 rounded-sm bg-background",
          hasEditAccess &&
            "hover:ring hover:ring-destructive group cursor-pointer",
        )}
        onClick={(e) => {
          e.stopPropagation();
          if (hasEditAccess) {
            handleDeleteMention(m);
          }
        }}
      >
        <div className="p-0.5">
          {m.type === "defaultTool" ? (
            <DefaultToolIcon
              name={m.name as DefaultToolName}
              className="size-3"
            />
          ) : m.type === "mcpServer" ? (
            <MCPIcon className="size-3" />
          ) : m.type === "workflow" ? (
            <Avatar
              style={m.icon?.style}
              className="size-3 ring-[1px] ring-input rounded-full"
            >
              <AvatarImage src={m.icon?.value} />
              <AvatarFallback>{m.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
          ) : m.type === "skill" ? (
            <Sparkles className="size-3" />
          ) : (
            <HammerIcon className="size-3" />
          )}
        </div>

        {m.name}

        {hasEditAccess && (
          <span className="ml-2">
            <XIcon className="size-2.5 text-muted-foreground group-hover:text-destructive" />
          </span>
        )}
      </div>
    ));
  }, [mentions, hasEditAccess, handleDeleteMention]);

  return (
    <ChatMentionInputSuggestion
      onSelectMention={handleSelectMention}
      onClose={noop}
      open={open && hasEditAccess && !disabled}
      disabledType={["agent"]}
      showSkills
      onOpenChange={(newOpen) => hasEditAccess && !disabled && setOpen(newOpen)}
      top={0}
      left={0}
      selectedIds={selectedIds}
      style={{
        width: triggerRect?.width ?? 0,
      }}
    >
      <div
        className={cn(
          "w-full justify-start flex items-center gap-2 px-3 py-4 rounded-md bg-secondary",
          hasEditAccess && !disabled && "hover:bg-input cursor-pointer",
        )}
        ref={triggerRef}
      >
        <div className="flex gap-2 items-center flex-wrap mr-auto">
          {isLoading ? (
            <span className="text-sm text-muted-foreground">
              {t("Agent.loadingTools")}
            </span>
          ) : selectedMentions.length === 0 ? (
            <span className="text-sm text-muted-foreground">
              {t("Agent.addTools")}
            </span>
          ) : (
            selectedMentions
          )}
        </div>
        {isLoading ? (
          <Loader className="size-4 animate-spin" />
        ) : (
          <ChevronDownIcon
            className={cn("size-4 transition-transform", open && "rotate-180")}
          />
        )}
      </div>
    </ChatMentionInputSuggestion>
  );
}
