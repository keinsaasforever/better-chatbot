"use client";

import { appStore } from "@/app/store";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { AllowedMCPServer, MCPServerInfo } from "app-types/mcp";
import { Package, Plus, Wrench, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "ui/dialog";
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
import { Input } from "ui/input";
import { useShallow } from "zustand/shallow";

export const calculateToolCount = (
  allowedMcpServers: Record<string, AllowedMCPServer>,
  mcpList: (MCPServerInfo & { id: string })[],
) => {
  return mcpList.reduce((acc, server) => {
    const count = allowedMcpServers[server.id]?.tools?.length;
    return acc + count;
  }, 0);
};

export function ToolPresets() {
  const { data: mcpList = [] } = useMcpList();
  const [appStoreMutate, presets, allowedMcpServers, allowedAppDefaultToolkit] =
    appStore(
      useShallow((state) => [
        state.mutate,
        state.toolPresets,
        state.allowedMcpServers,
        state.allowedAppDefaultToolkit,
      ]),
    );
  const [open, setOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const t = useTranslations();

  const presetWithToolCount = useMemo(() => {
    return presets.map((preset) => ({
      ...preset,
      toolCount: calculateToolCount(preset.allowedMcpServers ?? {}, mcpList),
    }));
  }, [presets, mcpList]);

  const addPreset = useCallback(
    (name: string) => {
      if (name.trim() === "") {
        toast.error(t("Chat.Tool.presetNameCannotBeEmpty"));
        return;
      }
      if (presets.find((p) => p.name === name)) {
        toast.error(t("Chat.Tool.presetNameAlreadyExists"));
        return;
      }
      appStoreMutate((prev) => {
        return {
          toolPresets: [
            ...prev.toolPresets,
            { name, allowedMcpServers, allowedAppDefaultToolkit },
          ],
        };
      });
      setPresetName("");
      setOpen(false);
    },
    [allowedMcpServers, allowedAppDefaultToolkit, presets],
  );

  const deletePreset = useCallback((index: number) => {
    appStoreMutate((prev) => {
      return {
        toolPresets: prev.toolPresets.filter((_, i) => i !== index),
      };
    });
  }, []);

  const applyPreset = useCallback((preset: (typeof presets)[number]) => {
    appStoreMutate({
      allowedMcpServers: preset.allowedMcpServers,
      allowedAppDefaultToolkit: preset.allowedAppDefaultToolkit,
    });
  }, []);

  return (
    <DropdownMenuGroup className="cursor-pointer">
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="text-xs flex items-center gap-2 font-semibold cursor-pointer">
          <Package className="size-3.5" />
          {t("Chat.Tool.preset")}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="w-[var(--radix-popper-available-width)] overflow-y-auto md:w-80 md:max-h-96">
            <DropdownMenuLabel className="flex flex-wrap items-center text-muted-foreground gap-2 text-xs">
              {t("Chat.Tool.toolPresets")}
              <div className="flex-1" />
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button variant={"secondary"} size={"sm"} className="text-xs">
                    {t("Chat.Tool.saveAsPreset")}
                    <Plus className="size-3.5" />
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("Chat.Tool.saveAsPreset")}</DialogTitle>
                  </DialogHeader>
                  <DialogDescription>
                    {t("Chat.Tool.saveAsPresetDescription")}
                  </DialogDescription>
                  <Input
                    placeholder="Preset Name"
                    value={presetName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                        addPreset(presetName);
                      }
                    }}
                    onChange={(e) => setPresetName(e.target.value)}
                  />
                  <Button
                    variant={"secondary"}
                    size={"sm"}
                    className="border"
                    onClick={() => {
                      addPreset(presetName);
                    }}
                  >
                    {t("Common.save")}
                  </Button>
                </DialogContent>
              </Dialog>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {presets.length === 0 ? (
              <div className="text-sm text-muted-foreground w-full h-full flex flex-col items-center justify-center gap-2 py-6">
                <p>{t("Chat.Tool.noPresetsAvailableYet")}</p>
                <p className="text-xs px-4">
                  {t("Chat.Tool.clickSaveAsPresetToGetStarted")}
                </p>
              </div>
            ) : (
              presetWithToolCount.map((preset, index) => {
                return (
                  <DropdownMenuItem
                    onClick={() => {
                      applyPreset(preset);
                    }}
                    key={preset.name}
                    className="flex items-center gap-2 cursor-pointer"
                  >
                    <Badge
                      variant={"secondary"}
                      className="rounded-full border-input"
                    >
                      <Wrench className="size-3.5" />
                      <span className="min-w-6 text-center">
                        {preset.toolCount}
                      </span>
                    </Badge>
                    <span className="font-semibold truncate">
                      {preset.name}
                    </span>

                    <div className="flex-1" />
                    <div
                      className="p-1 hover:bg-input rounded-full cursor-pointer"
                      onClick={(e) => {
                        e.preventDefault();
                        deletePreset(index);
                      }}
                    >
                      <X className="size-3.5" />
                    </div>
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}
