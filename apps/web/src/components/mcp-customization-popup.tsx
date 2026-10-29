"use client";

import { ReactNode, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";

import useSWR from "swr";
import { cn, fetcher } from "lib/utils";

import { useTranslations } from "next-intl";
import {
  McpServerCustomization,
  MCPServerInfo,
  McpToolCustomization,
  MCPToolInfo,
} from "app-types/mcp";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import {
  ArrowLeft,
  ChevronRight,
  Info,
  Loader,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "ui/button";
import { Textarea } from "ui/textarea";
import { safe } from "ts-safe";
import { z } from "zod";
import { handleErrorWithToast } from "ui/shared-toast";
import { Skeleton } from "ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { ToolDetailPopupContent } from "./tool-detail-popup";
import { ExamplePlaceholder } from "ui/example-placeholder";
import { Input } from "ui/input";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";

export function McpCustomizationPopup() {
  const [mcpCustomizationPopup, appStoreMutate] = appStore(
    useShallow((state) => [state.mcpCustomizationPopup, state.mutate]),
  );

  return (
    <Dialog
      open={!!mcpCustomizationPopup}
      onOpenChange={(open) => {
        if (!open) {
          appStoreMutate({ mcpCustomizationPopup: undefined });
        }
      }}
    >
      <DialogContent className="sm:max-w-[800px] fixed p-10 overflow-hidden">
        {mcpCustomizationPopup ? (
          <McpServerCustomizationContent
            mcpServerInfo={mcpCustomizationPopup}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function McpServerCustomizationContent({
  mcpServerInfo: { id, name, toolInfo, error },
  title,
}: {
  mcpServerInfo: MCPServerInfo & { id: string };
  title?: ReactNode;
}) {
  const t = useTranslations();

  const [prompt, setPrompt] = useState("");
  const [search, setSearch] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const [selectedTool, setSelectedTool] = useState<MCPToolInfo | null>(null);

  const handleSave = () => {
    setIsProcessing(true);
    safe(() =>
      z
        .object({
          prompt: z.string().min(1).max(3000),
        })
        .parse({
          prompt,
        }),
    )
      .map((body) =>
        fetch(`/api/mcp/server-customizations/${id}`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      )
      .ifOk(() => refreshMcpServerCustomization())
      .ifFail(handleErrorWithToast)
      .watch(() => {
        setIsProcessing(false);
      });
  };

  const handleDelete = () => {
    setIsProcessing(true);
    safe(() =>
      fetch(`/api/mcp/server-customizations/${id}`, {
        method: "DELETE",
      }),
    )
      .ifOk(() => refreshMcpServerCustomization())
      .ifFail(handleErrorWithToast)
      .watch(() => {
        setIsProcessing(false);
      });
  };

  const {
    data: mcpServerCustomization,
    mutate: refreshMcpServerCustomization,
    isLoading: isLoadingMcpServerCustomization,
  } = useSWR<null | McpServerCustomization>(
    `/api/mcp/server-customizations/${id}`,
    fetcher,
    {
      onSuccess: (data) => {
        setPrompt(data?.prompt || "");
      },
      revalidateOnFocus: false,
    },
  );

  const {
    data: mcpToolCustomizations,
    mutate: refreshMcpToolCustomizations,
    isLoading: isLoadingMcpToolCustomizations,
  } = useSWR<McpToolCustomization[]>(
    `/api/mcp/tool-customizations/${id}`,
    fetcher,
    {
      fallbackData: [],
    },
  );

  const toolCustomizations = useMemo(() => {
    const mcpToolCustomizationsMap = new Map(
      mcpToolCustomizations?.map((tool) => [tool.toolName, tool]),
    );
    return toolInfo
      .filter((tool) => tool.name.includes(search))
      .map((tool) => {
        return {
          name: tool.name,
          description: tool.description,
          prompt: mcpToolCustomizationsMap.get(tool.name)?.prompt || "",
          id: mcpToolCustomizationsMap.get(tool.name)?.id || null,
          inputSchema: tool.inputSchema,
        };
      });
  }, [mcpToolCustomizations, toolInfo, search]);

  if (selectedTool) {
    return (
      <ToolDetailPopupContent
        tool={selectedTool}
        serverId={id}
        onUpdate={refreshMcpToolCustomizations}
        title={
          <div className="flex flex-col">
            <button
              onClick={() => setSelectedTool(null)}
              className="flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground transition-colors mb-8"
            >
              <ArrowLeft className="size-3" />
              {t("Common.back")}
            </button>
            {selectedTool.name}
          </div>
        }
      />
    );
  }

  return (
    <div className="flex flex-col overflow-y-auto h-[70vh]">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 mb-2">
          {title || name}{" "}
          {error ? <p className="text-xs text-destructive">error</p> : null}
        </DialogTitle>
        <DialogDescription>{/*  */}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center">
        <h5 className="mr-auto flex items-center py-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs font-medium flex-1 flex items-center text-muted-foreground">
                {t("MCP.mcpServerCustomization")}
                <Info className="size-3 ml-1 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="whitespace-pre-wrap">
                {t("MCP.mcpServerCustomizationDescription")}
              </p>
            </TooltipContent>
          </Tooltip>
        </h5>
        {isProcessing || isLoadingMcpServerCustomization ? (
          <Button size="icon" variant="ghost">
            <Loader className="size-3 animate-spin" />
          </Button>
        ) : (
          <>
            {mcpServerCustomization?.id && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" onClick={handleDelete}>
                    <Trash2 className="size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("Common.delete")}</TooltipContent>
              </Tooltip>
            )}
            {prompt != (mcpServerCustomization?.prompt || "") && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="secondary" size="sm" onClick={handleSave}>
                    {t("Common.save")}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("Common.edit")}</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
      <div className="relative">
        <Textarea
          readOnly={isProcessing || isLoadingMcpServerCustomization}
          className={cn("resize-none h-20 overflow-y-auto w-full")}
          value={prompt}
          autoFocus
          onChange={(e) => setPrompt(e.target.value)}
        />
        {!prompt && (
          <div className="absolute left-0 top-0 w-full px-4 py-2 pointer-events-none">
            <ExamplePlaceholder
              placeholder={[t("MCP.mcpServerCustomizationPlaceholder")]}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 mt-4">
        <div className="text-xs flex items-center text-muted-foreground w-fit">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs font-medium flex-1 flex items-center text-muted-foreground">
                {t("MCP.additionalInstructions")}
                <Info className="size-3 ml-1 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="whitespace-pre-wrap">
                {t("MCP.toolCustomizationInstructions")}
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("MCP.searchTools")}
        />

        {isLoadingMcpToolCustomizations ? (
          Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))
        ) : (
          <div className="flex flex-col gap-2">
            {toolCustomizations.length === 0 ? (
              <Alert className="cursor-pointer py-8">
                <Wrench className="size-3.5" />
                <div className="flex w-full gap-2 items-center">
                  <div className="flex-1 min-w-0">
                    <AlertTitle>{t("MCP.noToolsAvailable")}</AlertTitle>
                  </div>
                </div>
              </Alert>
            ) : (
              toolCustomizations.map((tool) => {
                return (
                  <Alert
                    key={tool.name}
                    onClick={() => setSelectedTool(tool)}
                    className="cursor-pointer hover:bg-input"
                  >
                    <Wrench className="size-3.5" />
                    <div className="flex w-full gap-2 items-center">
                      <div className="flex-1 min-w-0">
                        <AlertTitle>{tool.name}</AlertTitle>
                        <AlertDescription className="flex gap-2 w-full min-w-0 items-start">
                          <p
                            className={cn(
                              !tool.prompt && "italic",
                              "text-xs text-muted-foreground whitespace-pre-wrap break-all line-clamp-3",
                            )}
                          >
                            {tool.prompt || "None"}
                          </p>
                        </AlertDescription>
                      </div>
                      <ChevronRight className="size-3.5 flex-shrink-0" />
                    </div>
                  </Alert>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
