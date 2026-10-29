"use client";
import React, {
  RefObject,
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from "react";

import { CheckIcon, HammerIcon, SearchIcon, Sparkles } from "lucide-react";
import { MCPIcon } from "ui/mcp-icon";

import { ChatMention } from "app-types/chat";

import MentionInput from "./mention-input";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";

import { appStore } from "@/app/store";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { cn, toAny } from "lib/utils";
import { useShallow } from "zustand/shallow";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Editor } from "@tiptap/react";
import { DefaultToolName } from "lib/ai/tools";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { DefaultToolIcon } from "./default-tool-icon";
import equal from "lib/equal";
import { EMOJI_DATA } from "lib/const";
import { useIsMobile } from "@/hooks/use-mobile";

type MentionItemType = {
  id: string;
  type: string;
  label: string;
  onSelect: () => void;
  icon: React.ReactNode;
  suffix?: React.ReactNode;
};

interface ChatMentionInputProps {
  onChange: (text: string) => void;
  onChangeMention: (mentions: ChatMention[]) => void;
  onEnter?: () => void;
  placeholder?: string;
  input: string;
  disabledMention?: boolean;
  ref?: RefObject<Editor | null>;
  onFocus?: () => void;
  onBlur?: () => void;
  autofocus?: boolean;
}

export default function ChatMentionInput({
  onChange,
  onChangeMention,
  onEnter,
  placeholder,
  ref,
  input,
  disabledMention,
  onFocus,
  onBlur,
  autofocus = true,
}: ChatMentionInputProps) {
  const latestMentions = useRef<string[]>([]);

  const handleChange = useCallback(
    ({
      text,
      mentions,
    }: { text: string; mentions: { label: string; id: string }[] }) => {
      onChange(text);
      const mentionsIds = mentions.map((mention) => mention.id);
      const parsedMentions = mentionsIds.map(
        (id) => JSON.parse(id) as ChatMention,
      );
      if (equal(latestMentions.current, mentionsIds)) return;
      latestMentions.current = mentionsIds;
      onChangeMention(parsedMentions);
    },
    [onChange, onChangeMention],
  );

  return (
    <MentionInput
      content={input}
      onEnter={onEnter}
      placeholder={placeholder}
      suggestionChar="@"
      disabledMention={disabledMention}
      onChange={handleChange}
      MentionItem={ChatMentionInputMentionItem}
      Suggestion={ChatMentionInputSuggestion}
      secondSuggestionChar="/"
      SecondSuggestion={SkillMentionSuggestion}
      editorRef={ref}
      onFocus={onFocus}
      onBlur={onBlur}
      autofocus={autofocus}
      fullWidthSuggestion={true}
    />
  );
}

export function ChatMentionInputMentionItem({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const item = useMemo(() => JSON.parse(id) as ChatMention, [id]);
  const label = useMemo(() => {
    return (
      <div
        className={cn(
          "flex items-center text-sm px-2 py-0.5 rounded-sm font-semibold transition-colors",
          "text-primary font-bold bg-primary/5",
          className,
        )}
      >
        {toAny(item).label || item.name}
      </div>
    );
  }, [item]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>{label}</TooltipTrigger>
      <TooltipContent className="p-4 whitespace-pre-wrap max-w-xs">
        {item.description || "mention"}
      </TooltipContent>
    </Tooltip>
  );
}

export function ChatMentionInputSuggestion({
  onSelectMention,
  onClose,
  top,
  left,
  selectedIds,
  className,
  open,
  onOpenChange,
  children,
  style,
  disabledType,
  showSkills = false,
}: {
  onClose: () => void;
  onSelectMention: (item: { label: string; id: string }) => void;
  top: number;
  left: number;
  className?: string;
  selectedIds?: string[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  disabledType?: ("mcp" | "workflow" | "defaultTool" | "agent" | "skill")[];
  // Skills are hidden by default (the chat "@" menu stays skill-free); the agent
  // editor opts in so skills can be attached to an agent.
  showSkills?: boolean;
}) {
  const t = useTranslations("Common");
  const { data: mcpList = [] } = useMcpList();
  const [workflowList, agentList, skillList] = appStore(
    useShallow((state) => [
      state.workflowToolList,
      state.agentList,
      state.skillList,
    ]),
  );
  const [searchValue, setSearchValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const itemRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const isMobile = useIsMobile();

  const mcpMentions = useMemo(() => {
    if (disabledType?.includes("mcp")) return [];
    const filtered = mcpList
      ?.filter((mcp) => mcp.toolInfo?.length)
      .filter((mcp) => {
        if (!searchValue) return true;
        const search = searchValue.toLowerCase();
        return (
          mcp.name.toLowerCase().includes(search) ||
          mcp.toolInfo?.some((tool) => tool.name.toLowerCase().includes(search))
        );
      });

    return (
      filtered?.flatMap((mcp) => {
        const mcpId = JSON.stringify({
          type: "mcpServer",
          name: mcp.name,
          serverId: mcp.id,
          description: `${mcp.name} is an MCP server that includes ${mcp.toolInfo?.length ?? 0} tool(s).`,
          toolCount: mcp.toolInfo?.length ?? 0,
        });

        const items: MentionItemType[] = [];

        // Add MCP server item
        if (
          !searchValue ||
          mcp.name.toLowerCase().includes(searchValue.toLowerCase())
        ) {
          items.push({
            id: `${mcp.id}-mcp`,
            type: "mcp",
            label: mcp.name,
            onSelect: () =>
              onSelectMention({
                label: `mcp("${mcp.name}")`,
                id: mcpId,
              }),
            icon: <MCPIcon className="size-3.5 text-foreground" />,
            suffix: selectedIds?.includes(mcpId) ? (
              <CheckIcon className="size-3 ml-auto" />
            ) : (
              <span className="ml-auto text-xs text-muted-foreground">
                {mcp.toolInfo?.length} tools
              </span>
            ),
          });
        }

        // Add tool items
        const toolItems =
          mcp.toolInfo
            ?.filter(
              (tool) =>
                !searchValue ||
                tool.name.toLowerCase().includes(searchValue.toLowerCase()),
            )
            .map((tool) => {
              const toolId = JSON.stringify({
                type: "mcpTool",
                name: tool.name,
                serverId: mcp.id,
                description: tool.description,
                serverName: mcp.name,
              });
              return {
                id: `${mcp.id}-${tool.name}`,
                type: "mcpTool",
                label: tool.name,
                onSelect: () =>
                  onSelectMention({
                    label: `tool("${tool.name}") `,
                    id: toolId,
                  }),
                icon: <HammerIcon className="size-3.5" />,
                suffix: selectedIds?.includes(toolId) && (
                  <CheckIcon className="size-3 ml-auto" />
                ),
              };
            }) || [];

        return [...items, ...toolItems];
      }) || []
    );
  }, [mcpList, selectedIds, disabledType, searchValue]);

  const agentMentions = useMemo(() => {
    if (disabledType?.includes("agent")) return [];
    if (!agentList.length) return [];

    return agentList
      .filter(
        (agent) =>
          !searchValue ||
          agent.name.toLowerCase().includes(searchValue.toLowerCase()),
      )
      .map((agent, i) => {
        const id = JSON.stringify({
          type: "agent",
          name: agent.name,
          agentId: agent.id,
          description: agent.description,
          icon: agent.icon,
        });
        return {
          id: agent.id,
          type: "agent",
          label: agent.name,
          onSelect: () =>
            onSelectMention({
              label: `agent("${agent.name}")`,
              id,
            }),
          icon: (
            <Avatar
              style={agent.icon?.style}
              className="size-3.5 ring-[1px] ring-input rounded-full"
            >
              <AvatarImage
                src={agent.icon?.value || EMOJI_DATA[i % EMOJI_DATA.length]}
              />
              <AvatarFallback>{agent.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
          ),
          suffix: selectedIds?.includes(id) && (
            <CheckIcon className="size-3 ml-auto" />
          ),
        };
      });
  }, [agentList, selectedIds, disabledType, searchValue]);

  const workflowMentions = useMemo(() => {
    if (disabledType?.includes("workflow")) return [];
    if (!workflowList.length) return [];

    return workflowList
      .filter(
        (workflow) =>
          !searchValue ||
          workflow.name.toLowerCase().includes(searchValue.toLowerCase()),
      )
      .map((workflow) => {
        const id = JSON.stringify({
          type: "workflow",
          name: workflow.name,
          workflowId: workflow.id,
          icon: workflow.icon,
          description: workflow.description,
        });
        return {
          id: workflow.id,
          type: "workflow",
          label: workflow.name,
          onSelect: () =>
            onSelectMention({
              label: `tool("${workflow.name}")`,
              id,
            }),
          icon: (
            <Avatar
              style={workflow.icon?.style}
              className="size-3.5 ring-[1px] ring-input rounded-full"
            >
              <AvatarImage src={workflow.icon?.value} />
              <AvatarFallback>{workflow.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
          ),
          suffix: selectedIds?.includes(id) && (
            <CheckIcon className="size-3 ml-auto" />
          ),
        };
      });
  }, [workflowList, selectedIds, disabledType, searchValue]);

  const skillMentions = useMemo(() => {
    if (!showSkills || disabledType?.includes("skill")) return [];
    if (!skillList.length) return [];

    return skillList
      .filter(
        (skill) =>
          !searchValue ||
          skill.name.toLowerCase().includes(searchValue.toLowerCase()),
      )
      .map((skill) => {
        const id = JSON.stringify({
          type: "skill",
          name: skill.name,
          skillId: skill.id,
          description: skill.description,
          icon: skill.icon,
        });
        return {
          id: skill.id,
          type: "skill",
          label: skill.name,
          onSelect: () =>
            onSelectMention({
              label: `skill("${skill.name}")`,
              id,
            }),
          icon: <Sparkles className="size-3.5 text-muted-foreground" />,
          suffix: selectedIds?.includes(id) && (
            <CheckIcon className="size-3 ml-auto" />
          ),
        };
      });
  }, [skillList, selectedIds, disabledType, searchValue, showSkills]);

  const defaultToolMentions = useMemo(() => {
    if (disabledType?.includes("defaultTool")) return [];
    const items = Object.values(DefaultToolName).map((toolName) => {
      let label = toolName as string;
      const icon = <DefaultToolIcon name={toolName} />;
      let description = "";
      switch (toolName) {
        case DefaultToolName.CreatePieChart:
          label = "pie-chart";
          description = "Create a pie chart";
          break;
        case DefaultToolName.CreateBarChart:
          label = "bar-chart";
          description = "Create a bar chart";
          break;
        case DefaultToolName.CreateLineChart:
          label = "line-chart";
          description = "Create a line chart";
          break;
        case DefaultToolName.CreateTable:
          label = "table";
          description = "Create a table";
          break;
        case DefaultToolName.WebSearch:
          label = "web-search";
          description = "Search the web";
          break;
        case DefaultToolName.WebContent:
          label = "web-content";
          description = "Get the content of a web page";
          break;
        case DefaultToolName.Http:
          label = "HTTP";
          description = "Send an http request";
          break;
        case DefaultToolName.JavascriptExecution:
          label = "js-execution";
          description = "Execute simple javascript code";
          break;
        case DefaultToolName.PythonExecution:
          label = "python-execution";
          description = "Execute simple python code";
          break;
      }
      return {
        id: toolName,
        label,
        icon,
        description,
      };
    });

    return items
      .filter(
        (item) =>
          !searchValue ||
          item.label.toLowerCase().includes(searchValue.toLowerCase()),
      )
      .map((item) => {
        const id = JSON.stringify({
          type: "defaultTool",
          name: item.id,
          label: item.label,
          description: item.description,
        });
        return {
          id: item.id,
          type: "defaultTool",
          label: item.label,
          onSelect: () =>
            onSelectMention({
              label: `tool('${item.label}')`,
              id,
            }),
          icon: item.icon,
          suffix: selectedIds?.includes(id) && (
            <CheckIcon className="size-3 ml-auto" />
          ),
        };
      });
  }, [selectedIds, disabledType, searchValue]);

  const trigger = useMemo(() => {
    if (children) return children;
    return (
      <span
        className="fixed z-50"
        style={{
          top,
          left,
        }}
      ></span>
    );
  }, [children, top, left]);

  // Combine all mentions
  const allMentions = useMemo(() => {
    return [
      ...agentMentions,
      ...skillMentions,
      ...workflowMentions,
      ...defaultToolMentions,
      ...mcpMentions,
    ];
  }, [
    agentMentions,
    skillMentions,
    workflowMentions,
    defaultToolMentions,
    mcpMentions,
  ]);

  // Reset selected index when mentions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [allMentions.length]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedItem = allMentions[selectedIndex];
    if (selectedItem && itemRefs.current[selectedItem.id]) {
      itemRefs.current[selectedItem.id]?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
  }, [selectedIndex, allMentions]);

  // Group mentions by type
  const groupedMentions = useMemo(() => {
    const groups = {
      agent: { title: "Agents", items: [] as MentionItemType[] },
      skill: { title: "Skills", items: [] as MentionItemType[] },
      workflow: { title: "Workflows", items: [] as MentionItemType[] },
      defaultTool: { title: "App Tools", items: [] as MentionItemType[] },
      mcp: { title: "MCP Tools", items: [] as MentionItemType[] },
      mcpTool: { title: "MCP Tools", items: [] as MentionItemType[] },
    };

    allMentions.forEach((mention) => {
      if (mention.type === "mcpTool") {
        groups.mcp.items.push(mention);
      } else if (groups[mention.type as keyof typeof groups]) {
        groups[mention.type as keyof typeof groups].items.push(mention);
      }
    });

    return groups;
  }, [allMentions]);

  return (
    <Popover
      open={open ?? true}
      onOpenChange={(f) => {
        !f && onClose();
        onOpenChange?.(f);
      }}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        className={cn("p-0", className)}
        align="start"
        side="top"
        style={{
          ...style,
          width: style?.width || (isMobile ? "100%" : "auto"),
          minWidth: isMobile ? undefined : "600px",
          maxWidth: isMobile ? undefined : "800px",
        }}
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b">
            <SearchIcon className="size-4 shrink-0 opacity-50" />
            <input
              className="flex h-8 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t("search")}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !e.currentTarget.value) {
                  onClose();
                }
                if (e.key === "Enter" && allMentions.length > 0) {
                  e.preventDefault();
                  allMentions[selectedIndex].onSelect();
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIndex((prev) =>
                    prev < allMentions.length - 1 ? prev + 1 : 0,
                  );
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIndex((prev) =>
                    prev > 0 ? prev - 1 : allMentions.length - 1,
                  );
                }
                if (
                  !isMobile &&
                  (e.key === "ArrowLeft" || e.key === "ArrowRight")
                ) {
                  e.preventDefault();
                  // Calculate column navigation
                  const currentItem = allMentions[selectedIndex];
                  const currentType =
                    currentItem.type === "mcpTool" ? "mcp" : currentItem.type;
                  const typeOrder = ["agent", "workflow", "mcp", "defaultTool"];
                  const currentTypeIndex = typeOrder.indexOf(currentType);

                  if (e.key === "ArrowLeft" && currentTypeIndex > 0) {
                    const prevType = typeOrder[currentTypeIndex - 1];
                    const prevTypeItems = allMentions.filter(
                      (item) =>
                        item.type === prevType ||
                        (prevType === "mcp" && item.type === "mcpTool"),
                    );
                    if (prevTypeItems.length > 0) {
                      setSelectedIndex(allMentions.indexOf(prevTypeItems[0]));
                    }
                  } else if (
                    e.key === "ArrowRight" &&
                    currentTypeIndex < typeOrder.length - 1
                  ) {
                    const nextType = typeOrder[currentTypeIndex + 1];
                    const nextTypeItems = allMentions.filter(
                      (item) =>
                        item.type === nextType ||
                        (nextType === "mcp" && item.type === "mcpTool"),
                    );
                    if (nextTypeItems.length > 0) {
                      setSelectedIndex(allMentions.indexOf(nextTypeItems[0]));
                    }
                  }
                }
              }}
              autoFocus
            />
          </div>

          <div
            className={cn(
              "overflow-hidden",
              isMobile ? "max-h-[50vh]" : "h-[300px]",
            )}
          >
            {allMentions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8">
                <div className="text-center">
                  <div className="mb-2">
                    {searchValue
                      ? t("noResults")
                      : "Type @ to see available mentions"}
                  </div>
                  {searchValue && (
                    <div className="text-xs opacity-60">
                      No results found for &quot;{searchValue}&quot;
                    </div>
                  )}
                </div>
              </div>
            ) : isMobile ? (
              // Mobile vertical layout
              <div className="overflow-y-auto max-h-[50vh]">
                {groupedMentions.agent.items.length > 0 && (
                  <div className="p-2">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.agent.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.agent.items.map((item) => (
                        <MentionItem
                          key={item.id}
                          item={item}
                          isSelected={
                            allMentions[selectedIndex]?.id === item.id
                          }
                          ref={(el) => {
                            itemRefs.current[item.id] = el;
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {groupedMentions.workflow.items.length > 0 && (
                  <div className="p-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.workflow.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.workflow.items.map((item) => (
                        <MentionItem
                          key={item.id}
                          item={item}
                          isSelected={
                            allMentions[selectedIndex]?.id === item.id
                          }
                          ref={(el) => {
                            itemRefs.current[item.id] = el;
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {showSkills && groupedMentions.skill.items.length > 0 && (
                  <div className="p-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.skill.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.skill.items.map((item) => (
                        <MentionItem
                          key={item.id}
                          item={item}
                          isSelected={
                            allMentions[selectedIndex]?.id === item.id
                          }
                          ref={(el) => {
                            itemRefs.current[item.id] = el;
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {groupedMentions.defaultTool.items.length > 0 && (
                  <div className="p-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.defaultTool.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.defaultTool.items.map((item) => (
                        <MentionItem
                          key={item.id}
                          item={item}
                          isSelected={
                            allMentions[selectedIndex]?.id === item.id
                          }
                          ref={(el) => {
                            itemRefs.current[item.id] = el;
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {groupedMentions.mcp.items.length > 0 && (
                  <div className="p-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.mcp.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.mcp.items.map((item) => (
                        <MentionItem
                          key={item.id}
                          item={item}
                          isSelected={
                            allMentions[selectedIndex]?.id === item.id
                          }
                          ref={(el) => {
                            itemRefs.current[item.id] = el;
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              // Desktop horizontal layout
              <div className="flex flex-1 h-[300px]">
                {/* Agents & Workflows Column */}
                <div className="flex-1 border-r overflow-y-auto">
                  <div className="p-2">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.agent.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.agent.items.length > 0 ? (
                        groupedMentions.agent.items.map((item) => (
                          <MentionItem
                            key={item.id}
                            item={item}
                            isSelected={
                              allMentions[selectedIndex]?.id === item.id
                            }
                            ref={(el) => {
                              itemRefs.current[item.id] = el;
                            }}
                          />
                        ))
                      ) : (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                          No agents found
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="p-2 border-t">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.workflow.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.workflow.items.length > 0 ? (
                        groupedMentions.workflow.items.map((item) => (
                          <MentionItem
                            key={item.id}
                            item={item}
                            isSelected={
                              allMentions[selectedIndex]?.id === item.id
                            }
                            ref={(el) => {
                              itemRefs.current[item.id] = el;
                            }}
                          />
                        ))
                      ) : (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                          No workflows found
                        </div>
                      )}
                    </div>
                  </div>
                  {showSkills && groupedMentions.skill.items.length > 0 && (
                    <div className="p-2 border-t">
                      <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                        {groupedMentions.skill.title}
                      </div>
                      <div className="space-y-1">
                        {groupedMentions.skill.items.map((item) => (
                          <MentionItem
                            key={item.id}
                            item={item}
                            isSelected={
                              allMentions[selectedIndex]?.id === item.id
                            }
                            ref={(el) => {
                              itemRefs.current[item.id] = el;
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* MCP Tools Column */}
                <div className="flex-1 border-r overflow-y-auto">
                  <div className="p-2">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.mcp.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.mcp.items.length > 0 ? (
                        groupedMentions.mcp.items.map((item) => (
                          <MentionItem
                            key={item.id}
                            item={item}
                            isSelected={
                              allMentions[selectedIndex]?.id === item.id
                            }
                            ref={(el) => {
                              itemRefs.current[item.id] = el;
                            }}
                          />
                        ))
                      ) : (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                          No MCP tools found
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Default Tools Column */}
                <div className="flex-1 overflow-y-auto">
                  <div className="p-2">
                    <div className="text-xs font-medium text-muted-foreground px-2 py-1.5">
                      {groupedMentions.defaultTool.title}
                    </div>
                    <div className="space-y-1">
                      {groupedMentions.defaultTool.items.length > 0 ? (
                        groupedMentions.defaultTool.items.map((item) => (
                          <MentionItem
                            key={item.id}
                            item={item}
                            isSelected={
                              allMentions[selectedIndex]?.id === item.id
                            }
                            ref={(el) => {
                              itemRefs.current[item.id] = el;
                            }}
                          />
                        ))
                      ) : (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                          No app tools found
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Compact single-column popup for the "/" trigger: shows only the user's saved
// skills and inserts a skill mention. Kept separate from the full "@" menu so
// the two triggers stay independent.
export function SkillMentionSuggestion({
  onSelectMention,
  onClose,
  style,
}: {
  top: number;
  left: number;
  onClose: () => void;
  onSelectMention: (item: { label: string; id: string }) => void;
  style?: React.CSSProperties;
}) {
  const skillList = appStore((state) => state.skillList);
  const [searchValue, setSearchValue] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const isMobile = useIsMobile();

  const items = useMemo(() => {
    return skillList
      .filter(
        (skill) =>
          !searchValue ||
          skill.name.toLowerCase().includes(searchValue.toLowerCase()),
      )
      .map((skill) => {
        const id = JSON.stringify({
          type: "skill",
          name: skill.name,
          skillId: skill.id,
          description: skill.description,
          icon: skill.icon,
        });
        return {
          id: skill.id,
          type: "skill",
          label: skill.name,
          description: skill.description,
          onSelect: () =>
            onSelectMention({ label: `skill("${skill.name}")`, id }),
          icon: <Sparkles className="size-3.5 text-muted-foreground" />,
        } as MentionItemType & { description?: string };
      });
  }, [skillList, searchValue, onSelectMention]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items.length]);

  return (
    <Popover open onOpenChange={(f) => !f && onClose()}>
      <PopoverTrigger asChild>
        <span
          className="fixed z-50"
          style={{ top: style?.top, left: style?.left }}
        />
      </PopoverTrigger>
      <PopoverContent
        className="p-0"
        align="start"
        side="top"
        style={{
          ...style,
          width: style?.width || (isMobile ? "100%" : "auto"),
          minWidth: isMobile ? undefined : "320px",
          maxWidth: isMobile ? undefined : "480px",
        }}
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b">
            <SearchIcon className="size-4 shrink-0 opacity-50" />
            <input
              className="flex h-8 w-full rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search skills…"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Backspace" && !e.currentTarget.value) onClose();
                if (e.key === "Enter" && items.length > 0) {
                  e.preventDefault();
                  items[selectedIndex]?.onSelect();
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIndex((p) => (p < items.length - 1 ? p + 1 : 0));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIndex((p) => (p > 0 ? p - 1 : items.length - 1));
                }
              }}
              autoFocus
            />
          </div>
          <div
            className={cn(
              "overflow-y-auto p-2",
              isMobile ? "max-h-[50vh]" : "max-h-[300px]",
            )}
          >
            {items.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground p-6">
                {searchValue
                  ? `No skills found for "${searchValue}"`
                  : "No skills saved yet. Add one from the Tools menu."}
              </div>
            ) : (
              <div className="space-y-1">
                {items.map((item, i) => (
                  <MentionItem
                    key={item.id}
                    item={item}
                    isSelected={i === selectedIndex}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const MentionItem = React.forwardRef<
  HTMLButtonElement,
  { item: MentionItemType; isSelected: boolean }
>(({ item, isSelected }, ref) => {
  return (
    <button
      ref={ref}
      className={cn(
        "flex items-center gap-2 w-full rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground cursor-pointer",
        isSelected && "bg-accent text-accent-foreground",
      )}
      onClick={() => item.onSelect()}
    >
      {item.icon}
      <span className="truncate min-w-0">{item.label}</span>
      {item.suffix}
    </button>
  );
});
MentionItem.displayName = "MentionItem";
