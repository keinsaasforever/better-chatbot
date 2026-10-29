"use client";

import { appStore } from "@/app/store";
import { useChatModels } from "@/hooks/queries/use-chat-models";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { useWorkflowToolList } from "@/hooks/queries/use-workflow-tool-list";
import { useIsMobile } from "@/hooks/use-mobile";
import { AgentSummary } from "app-types/agent";
import { ChatMention } from "app-types/chat";
import { SkillSummary } from "app-types/skill";
import { WorkflowSummary } from "app-types/workflow";
import {
  filterDeferredAppToolkits,
  getUserConfigurableAppToolkits,
} from "lib/ai/tools/resolve-allowed-toolkits";
import { cn, objectFlow } from "lib/utils";
import { AtSign, Loader, WrenchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { CountAnimation } from "ui/count-animation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { Separator } from "ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useShallow } from "zustand/shallow";
import { AgentSelector } from "./agent-selector";
import { AppDefaultToolKitSelector } from "./app-default-toolkit-selector";
import { ImageGeneratorSelector } from "./image-generator-selector";
import { McpServerSelector } from "./mcp-server-selector";
import { SkillSelector } from "./skill-selector";
import { ToolPresets } from "./tool-presets";
import { WorkflowToolSelector } from "./workflow-tool-selector";

interface ToolSelectDropdownProps {
  align?: "start" | "end" | "center";
  side?: "left" | "right" | "top" | "bottom";
  disabled?: boolean;
  mentions?: ChatMention[];
  projectId?: string;
  onSelectWorkflow?: (workflow: WorkflowSummary) => void;
  onSelectAgent?: (agent: AgentSummary) => void;
  onSelectSkill?: (skill: {
    id: string;
    name: string;
    description?: string;
    icon?: SkillSummary["icon"];
  }) => void;
  onGenerateImage?: (model?: string) => void;
  className?: string;
  compact?: boolean;
  hideToolCount?: boolean;
}

export function ToolSelectDropdown({
  align,
  side,
  onSelectWorkflow,
  onSelectAgent,
  onSelectSkill,
  onGenerateImage,
  mentions,
  projectId,
  className,
  compact,
  hideToolCount,
}: ToolSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const triggerRef = useRef<HTMLDivElement>(null);
  // On phones the trigger sits mid-composer, so a menu anchored to it leaves
  // almost no room for the submenus that open next to it. Measure the trigger
  // on open and shift the menu to the left viewport edge (never to the right).
  const [alignOffset, setAlignOffset] = useState(0);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      const left = triggerRef.current?.getBoundingClientRect().left ?? 0;
      setAlignOffset(Math.min(0, -(left - 8)));
    } else {
      setAlignOffset(0);
    }
    setOpen(nextOpen);
  }, []);
  const [toolChoice, allowedAppDefaultToolkit, allowedMcpServers] = appStore(
    useShallow((state) => [
      state.toolChoice,
      state.allowedAppDefaultToolkit,
      state.allowedMcpServers,
    ]),
  );

  const t = useTranslations("Chat.Tool");
  const { data: mcpList = [], isLoading } = useMcpList();
  const { data: providers } = useChatModels();
  const [globalModel] = appStore(useShallow((state) => [state.chatModel]));

  const modelInfo = useMemo(() => {
    const provider = providers?.find(
      (provider) => provider.provider === globalModel?.provider,
    );
    const model = provider?.models.find(
      (model) => model.name === globalModel?.model,
    );
    return model;
  }, [providers, globalModel]);

  useWorkflowToolList({
    refreshInterval: 1000 * 60 * 5,
  });

  const agentMention = useMemo(() => {
    return mentions?.find((m) => m.type === "agent");
  }, [mentions]);

  const bindingTools = useMemo<string[]>(() => {
    if (mentions?.length) {
      return mentions.map((m) => m.name);
    }
    if (toolChoice == "none") return [];
    const translate = t.raw("defaultToolKit");
    const visibleToolkits = filterDeferredAppToolkits(
      allowedAppDefaultToolkit,
    ).filter((toolkit) => getUserConfigurableAppToolkits().includes(toolkit));
    const defaultTools = visibleToolkits.map((t) => translate[t]);
    const mcpIds = mcpList.map((v) => v.id);
    const mcpTools = Object.values(
      objectFlow(allowedMcpServers ?? {}).filter((_, id) =>
        mcpIds.includes(id),
      ),
    )
      .map((v) => v.tools)
      .flat();

    return [...defaultTools, ...mcpTools];
  }, [
    mentions,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    toolChoice,
    mcpList,
    projectId,
    t,
  ]);

  const triggerButton = useMemo(() => {
    return (
      <Button
        variant="ghost"
        size={"sm"}
        className={cn(
          "gap-0.5 bg-input/60 border rounded-full data-[state=open]:bg-input! hover:bg-input!",
          compact && "h-7 px-2 text-xs",
          !bindingTools.length &&
            !isLoading &&
            "text-muted-foreground bg-transparent border-transparent",
          isLoading && "bg-input/60",
          open && "bg-input!",
          className,
        )}
      >
        <span className={!bindingTools ? "text-muted-foreground" : ""}>
          {agentMention
            ? "Agent"
            : (mentions?.length ?? 0 > 0)
              ? "Mention"
              : "Tools"}
        </span>

        {!hideToolCount &&
          ((!agentMention && bindingTools.length > 0) || isLoading) && (
            <>
              <div className="h-4 hidden sm:block mx-1">
                <Separator orientation="vertical" />
              </div>

              <div className="min-w-5 flex justify-center">
                {isLoading ? (
                  <Loader className="animate-spin size-3.5" />
                ) : (mentions?.length ?? 0) > 0 ? (
                  <AtSign className="size-3.5" />
                ) : (
                  <CountAnimation
                    number={bindingTools.length}
                    className="text-xs"
                  />
                )}
              </div>
            </>
          )}
      </Button>
    );
  }, [
    mentions?.length,
    bindingTools.length,
    isLoading,
    open,
    compact,
    hideToolCount,
    className,
    agentMention,
    t,
  ]);

  useEffect(() => {
    if (bindingTools.length > 128) {
      toast("Too many tools selected, please select less than 128 tools");
    }
  }, [bindingTools.length > 128]);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <div ref={triggerRef}>
          <Tooltip>
            <TooltipTrigger asChild>{triggerButton}</TooltipTrigger>
            <TooltipContent align={align} side={side} className="p-4 text-xs  ">
              <div className="flex items-center gap-2">
                <WrenchIcon className="size-3.5" />
                <span className="text-sm">{t("toolsSetup")}</span>
              </div>

              <p className="text-muted-foreground mt-4 whitespace-pre-wrap">
                {t("toolsSetupDescription")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </DropdownMenuTrigger>
      {/* Reserve room for the mobile browser toolbar so the menu is not placed
          (or flipped) into the area it covers. */}
      <DropdownMenuContent
        className="max-w-[13rem] md:w-72 md:max-w-none"
        alignOffset={isMobile ? alignOffset : undefined}
        align={align}
        side={side}
        collisionPadding={{ top: 12, bottom: 88 }}
      >
        <SkillSelector onSelectSkill={onSelectSkill} />
        <div className="py-1">
          <DropdownMenuSeparator />
        </div>
        <WorkflowToolSelector onSelectWorkflow={onSelectWorkflow} />
        <div className="py-1">
          <DropdownMenuSeparator />
        </div>
        <AgentSelector onSelectAgent={onSelectAgent} />
        <div className="py-1">
          <DropdownMenuSeparator />
        </div>
        <ImageGeneratorSelector
          onGenerateImage={onGenerateImage}
          modelInfo={modelInfo}
        />
        <div className="py-1">
          <DropdownMenuSeparator />
        </div>
        <div className="py-2">
          <ToolPresets />
          <div className="py-1">
            <DropdownMenuSeparator />
          </div>
          <AppDefaultToolKitSelector projectId={projectId} />
          <div className="py-1">
            <DropdownMenuSeparator />
          </div>
          <McpServerSelector />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
