"use client";

import { appStore } from "@/app/store";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { redriectMcpOauth } from "lib/ai/mcp/oauth-redirect";
import { cn } from "lib/utils";
import { ChevronRight, Loader, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Alert, AlertDescription, AlertTitle } from "ui/alert";
import { Button } from "ui/button";
import { Checkbox } from "ui/checkbox";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "ui/dropdown-menu";
import { MCPIcon } from "ui/mcp-icon";
import { handleErrorWithToast } from "ui/shared-toast";
import { Switch } from "ui/switch";
import { useShallow } from "zustand/shallow";

export function McpServerSelector() {
  const { data: mcpServerList = [] } = useMcpList();
  const [appStoreMutate, allowedMcpServers] = appStore(
    useShallow((state) => [state.mutate, state.allowedMcpServers]),
  );

  const selectedMcpServerList = useMemo(() => {
    if (mcpServerList.length === 0) return [];
    return [...mcpServerList]
      .sort(
        (a, b) =>
          (a.status === "connected" ? -1 : 1) -
          (b.status === "connected" ? -1 : 1),
      )
      .map((server) => {
        const allowedTools: string[] =
          allowedMcpServers?.[server.id]?.tools ?? [];

        return {
          id: server.id,
          serverName: server.name,
          checked: allowedTools.length > 0,
          tools: server.toolInfo.map((tool) => ({
            name: tool.name,
            checked: allowedTools.includes(tool.name),
            description: tool.description,
          })),
          error: server.error,
          status: server.status,
        };
      });
  }, [mcpServerList, allowedMcpServers]);

  const setMcpServerTool = useCallback(
    (serverId: string, toolNames: string[]) => {
      appStoreMutate((prev) => {
        return {
          allowedMcpServers: {
            ...prev.allowedMcpServers,
            [serverId]: {
              ...(prev.allowedMcpServers?.[serverId] ?? {}),
              tools: toolNames,
            },
          },
        };
      });
    },
    [],
  );
  return (
    <DropdownMenuGroup>
      {!selectedMcpServerList.length ? (
        <div className="text-sm text-muted-foreground w-full h-full flex flex-col items-center justify-center py-6">
          <div>No MCP servers detected.</div>
          <Link href="/mcp">
            <Button
              variant={"ghost"}
              className="mt-2 text-primary flex items-center gap-1"
            >
              Connect a tool <ChevronRight className="size-4" />
            </Button>
          </Link>
        </div>
      ) : (
        selectedMcpServerList.map((server) => (
          <DropdownMenuSub key={server.id}>
            <DropdownMenuSubTrigger
              className="flex items-center gap-2 font-semibold cursor-pointer"
              icon={
                <div className="flex items-center gap-2 ml-auto">
                  {server.status === "authorizing" ? (
                    <div className="flex items-center gap-1">
                      <ShieldAlertIcon className="size-3 text-muted-foreground" />
                    </div>
                  ) : (
                    <>
                      {server.tools.filter((t) => t.checked).length > 0 ? (
                        <span className="w-5 h-5 items-center justify-center flex text-[8px] text-muted-foreground font-semibold ">
                          {server.tools.filter((t) => t.checked).length}
                        </span>
                      ) : null}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </>
                  )}
                </div>
              }
              onClick={(e) => {
                e.preventDefault();
                setMcpServerTool(
                  server.id,
                  server.checked ? [] : server.tools.map((t) => t.name),
                );
              }}
            >
              <div className="flex items-center justify-center p-1 rounded bg-input/40 border">
                <MCPIcon className="fill-foreground size-2.5" />
              </div>

              <span className={cn("truncate", !server.checked && "opacity-30")}>
                {server.serverName}
              </span>
              {Boolean(server.error) ? (
                <span
                  className={cn("text-xs text-destructive ml-1 p-1 rounded")}
                >
                  error
                </span>
              ) : null}
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className="w-[var(--radix-popper-available-width)] relative md:w-80">
                <McpServerToolSelector
                  tools={server.tools}
                  isAuthorizing={server.status === "authorizing"}
                  checked={server.checked}
                  serverId={server.id}
                  onClickAllChecked={(checked) => {
                    setMcpServerTool(
                      server.id,
                      checked ? server.tools.map((t) => t.name) : [],
                    );
                  }}
                  onToolClick={(toolName, checked) => {
                    const currentTools = server.tools
                      .filter((v) => v.checked)
                      .map((v) => v.name);

                    setMcpServerTool(
                      server.id,
                      checked
                        ? currentTools.concat(toolName)
                        : currentTools.filter((v) => v !== toolName),
                    );
                  }}
                />
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        ))
      )}
    </DropdownMenuGroup>
  );
}

interface McpServerToolSelectorProps {
  tools: {
    name: string;
    checked: boolean;
    description: string;
  }[];
  isAuthorizing: boolean;
  serverId: string;
  onClickAllChecked: (checked: boolean) => void;
  checked: boolean;
  onToolClick: (toolName: string, checked: boolean) => void;
}
function McpServerToolSelector({
  tools,
  serverId,
  onClickAllChecked,
  isAuthorizing,
  checked,
  onToolClick,
}: McpServerToolSelectorProps) {
  const t = useTranslations("Common");
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const filteredTools = useMemo(() => {
    return tools.filter((tool) =>
      tool.name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [tools, search]);

  const handleAuthorize = useCallback(
    () =>
      safe(() => setLoading(true))
        .map(() => redriectMcpOauth(serverId))
        .ifOk(() => mutate("/api/mcp/list"))
        .ifFail(handleErrorWithToast)
        .watch(() => setLoading(false)),

    [serverId],
  );

  if (isAuthorizing) {
    return (
      <Alert
        className="cursor-pointer hover:bg-accent/10 transition-colors border-none"
        onClick={handleAuthorize}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleAuthorize();
          }
        }}
      >
        {loading ? <Loader className="animate-spin" /> : <ShieldAlertIcon />}

        <AlertTitle>Authorization Required</AlertTitle>
        <AlertDescription>
          Click here to authorize this MCP server and access its tools.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <div>
      <DropdownMenuLabel
        className="text-muted-foreground flex items-center gap-2"
        onClick={(e) => {
          e.preventDefault();
          onClickAllChecked(!checked);
        }}
      >
        <input
          autoFocus
          placeholder={t("search")}
          value={search}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
          onChange={(e) => setSearch(e.target.value)}
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="placeholder:text-muted-foreground flex w-full text-xs   outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
        />
        <div className="flex-1" />
        <Switch checked={checked} />
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div className="max-h-96 overflow-y-auto">
        {filteredTools.length === 0 ? (
          <div className="text-sm text-muted-foreground w-full h-full flex items-center justify-center py-6">
            {t("noResults")}
          </div>
        ) : (
          filteredTools.map((tool) => (
            <DropdownMenuItem
              key={tool.name}
              className="flex items-center gap-2 cursor-pointer mb-1"
              onClick={(e) => {
                e.preventDefault();
                onToolClick(tool.name, !tool.checked);
              }}
            >
              <div className="mx-1 flex-1 min-w-0">
                <p className="font-medium text-xs mb-1 truncate">{tool.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {tool.description}
                </p>
              </div>
              <Checkbox checked={tool.checked} className="ml-auto" />
            </DropdownMenuItem>
          ))
        )}
      </div>
    </div>
  );
}
