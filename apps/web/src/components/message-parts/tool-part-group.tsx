"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import { type ToolUIPart, type UIMessage, getToolName } from "ai";
import type { ChatMetadata } from "app-types/chat";
import { extractMCPToolId } from "lib/ai/mcp/mcp-tool-id";
import { cn } from "lib/utils";
import {
  ChevronDownIcon,
  ChevronRight,
  HammerIcon,
  Loader,
  TriangleAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useMemo, useState } from "react";
import { Separator } from "ui/separator";
import { TextShimmer } from "ui/text-shimmer";
import { ReasoningPart } from "./reasoning-part";
import { ToolMessagePart } from "./tool-part";
import {
  type IndexedMessagePart,
  isGroupableToolPart,
} from "./tool-part-grouping";

/**
 * Cheap identity comparison. Deep-equalling tool outputs here would undo the
 * work `ToolMessagePart` does to keep streaming re-renders O(1) — see its own
 * memo comparator.
 */
function shallowPartsEqual(a: IndexedMessagePart[], b: IndexedMessagePart[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].index !== b[i].index) return false;
    const prev = a[i].part as any;
    const next = b[i].part as any;
    if (
      prev.type !== next.type ||
      prev.state !== next.state ||
      prev.toolCallId !== next.toolCallId ||
      prev.errorText !== next.errorText ||
      prev.text !== next.text
    ) {
      return false;
    }
    // Terminal tool outputs are immutable in the AI SDK, so a fresh-but-equal
    // object there is not a change. Only a still-producing tool can differ.
    if (
      (prev.input !== next.input || prev.output !== next.output) &&
      next.state !== "output-available" &&
      next.state !== "output-error"
    ) {
      return false;
    }
  }
  return true;
}

interface ToolPartGroupProps {
  parts: IndexedMessagePart[];
  messageId: string;
  threadId?: string;
  keyPrefix: string;
  lastPartIndex: number;
  isLastMessage?: boolean;
  isLoading?: boolean;
  readonly?: boolean;
  projectId?: string;
  setMessages?: UseChatHelpers<UIMessage>["setMessages"];
  addToolResult?: UseChatHelpers<UIMessage>["addToolResult"];
  addToolApprovalResponse?: UseChatHelpers<UIMessage>["addToolApprovalResponse"];
  chatStatus?: UseChatHelpers<UIMessage>["status"];
  runStatus?: ChatMetadata["runStatus"];
}

/**
 * Collapses a run of plain tool calls into one line: icon, MCP server name and
 * a count. Expanding reveals the individual calls (and the reasoning between
 * them) so the raw request/response payloads stay one click away.
 */
export const ToolPartGroup = memo(
  function ToolPartGroup({
    parts,
    messageId,
    threadId,
    keyPrefix,
    lastPartIndex,
    isLastMessage,
    isLoading,
    readonly,
    projectId,
    setMessages,
    addToolResult,
    addToolApprovalResponse,
    chatStatus,
    runStatus,
  }: ToolPartGroupProps) {
    const t = useTranslations("Chat.Tool");
    const [manuallyExpanded, setManuallyExpanded] = useState<boolean | null>(
      null,
    );

    const summary = useMemo(() => {
      const servers: string[] = [];
      let running: { serverName: string; toolName: string } | null = null;
      let hasError = false;
      let count = 0;

      for (const { part } of parts) {
        if (!isGroupableToolPart(part)) continue;
        count++;
        const { serverName, toolName } = extractMCPToolId(
          getToolName(part as ToolUIPart),
        );
        if (serverName && !servers.includes(serverName))
          servers.push(serverName);
        if ((part as ToolUIPart).state === "output-error") hasError = true;
        if (!running && !(part as ToolUIPart).state.startsWith("output")) {
          running = { serverName, toolName };
        }
      }

      return { servers, running, hasError, count };
    }, [parts]);

    // A failed call flags the row rather than springing it open — the payload
    // dump is the developer detail this whole component exists to hide.
    const isExpanded = manuallyExpanded ?? false;
    // Name the servers that were used — that is the part a user recognizes.
    const title = summary.servers.length
      ? summary.servers.slice(0, 2).join(" · ") +
        (summary.servers.length > 2 ? ` +${summary.servers.length - 2}` : "")
      : t("toolCalls");
    const detail = summary.running
      ? summary.running.toolName || summary.running.serverName
      : t("toolCallCount", { count: summary.count });

    return (
      <div className="flex flex-col fade-in duration-300 animate-in">
        <button
          type="button"
          className="flex gap-2 items-center cursor-pointer group/title text-left"
          onClick={() => setManuallyExpanded(!isExpanded)}
        >
          <div className="p-1.5 text-primary bg-input/40 rounded">
            {summary.running ? (
              <Loader className="size-3.5 animate-spin" />
            ) : summary.hasError ? (
              <TriangleAlert className="size-3.5 text-destructive" />
            ) : (
              <HammerIcon className="size-3.5" />
            )}
          </div>
          <span className="font-bold flex items-center gap-2">
            {summary.running ? <TextShimmer>{title}</TextShimmer> : title}
          </span>
          <ChevronRight className="size-3.5" />
          <span
            className={cn(
              "truncate transition-colors duration-300",
              summary.hasError
                ? "text-destructive"
                : "text-muted-foreground group-hover/title:text-primary",
            )}
          >
            {detail}
          </span>
          <div className="ml-auto group-hover/title:bg-input p-1.5 rounded transition-colors duration-300">
            <ChevronDownIcon
              className={cn(isExpanded && "rotate-180", "size-3.5")}
            />
          </div>
        </button>

        {isExpanded && (
          <div className="flex gap-2 py-2">
            <div className="w-7 flex justify-center">
              <Separator
                orientation="vertical"
                className="h-full bg-gradient-to-t from-transparent to-border to-5%"
              />
            </div>
            <div className="min-w-0 w-full flex flex-col gap-4">
              {parts.map(({ part, index }) => {
                const key = `${keyPrefix}-${part.type}-${index}`;
                if (part.type === "reasoning") {
                  return (
                    <ReasoningPart
                      key={key}
                      readonly={readonly}
                      reasoningText={part.text}
                    />
                  );
                }
                if (!isGroupableToolPart(part)) return null;
                const isLastPart = index === lastPartIndex;
                return (
                  <ToolMessagePart
                    key={key}
                    part={part as ToolUIPart}
                    messageId={messageId}
                    threadId={threadId}
                    projectId={projectId}
                    readonly={readonly}
                    isLast={isLastMessage && isLastPart}
                    showActions={
                      !readonly &&
                      (isLastMessage ? isLastPart && !isLoading : isLastPart)
                    }
                    addToolResult={addToolResult}
                    addToolApprovalResponse={addToolApprovalResponse}
                    chatStatus={chatStatus}
                    runStatus={runStatus}
                    setMessages={setMessages}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    if (prev.messageId !== next.messageId) return false;
    if (prev.threadId !== next.threadId) return false;
    if (prev.isLastMessage !== next.isLastMessage) return false;
    if (prev.isLoading !== next.isLoading) return false;
    if (prev.readonly !== next.readonly) return false;
    if (prev.chatStatus !== next.chatStatus) return false;
    if (prev.runStatus !== next.runStatus) return false;
    if (prev.lastPartIndex !== next.lastPartIndex) return false;
    return shallowPartsEqual(prev.parts, next.parts);
  },
);

ToolPartGroup.displayName = "ToolPartGroup";
