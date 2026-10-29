"use client";

import { appStore } from "@/app/store";
import { AppDefaultToolkit } from "lib/ai/tools";
import { getUserConfigurableAppToolkits } from "lib/ai/tools/resolve-allowed-toolkits";
import { cn } from "lib/utils";
import {
  ChartColumn,
  CodeIcon,
  GlobeIcon,
  HardDriveUploadIcon,
  MonitorPlayIcon,
  Wrench,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { DropdownMenuGroup, DropdownMenuItem } from "ui/dropdown-menu";
import { Switch } from "ui/switch";
import { useShallow } from "zustand/shallow";

export function AppDefaultToolKitSelector({
  projectId,
}: {
  projectId?: string;
}) {
  const [appStoreMutate, allowedAppDefaultToolkit] = appStore(
    useShallow((state) => [state.mutate, state.allowedAppDefaultToolkit]),
  );
  const t = useTranslations();
  const toggleAppDefaultToolkit = useCallback((toolkit: AppDefaultToolkit) => {
    appStoreMutate((prev) => {
      const newAllowedAppDefaultToolkit = [
        ...(prev.allowedAppDefaultToolkit ?? []),
      ];
      if (newAllowedAppDefaultToolkit.includes(toolkit)) {
        newAllowedAppDefaultToolkit.splice(
          newAllowedAppDefaultToolkit.indexOf(toolkit),
          1,
        );
      } else {
        newAllowedAppDefaultToolkit.push(toolkit);
      }
      return { allowedAppDefaultToolkit: newAllowedAppDefaultToolkit };
    });
  }, []);

  const defaultToolInfo = useMemo(() => {
    const raw = t.raw("Chat.Tool.defaultToolKit");
    return getUserConfigurableAppToolkits({ projectId }).map((toolkit) => {
      const label = raw[toolkit] || toolkit;
      const id = toolkit;
      let icon = Wrench;
      switch (toolkit) {
        case AppDefaultToolkit.Visualization:
          icon = ChartColumn;
          break;
        case AppDefaultToolkit.WebSearch:
          icon = GlobeIcon;
          break;
        case AppDefaultToolkit.Http:
          icon = HardDriveUploadIcon;
          break;
        case AppDefaultToolkit.Code:
          icon = CodeIcon;
          break;
        case AppDefaultToolkit.BrowserAutomation:
          icon = MonitorPlayIcon;
          break;
      }
      return {
        label,
        id,
        icon,
      };
    });
  }, [projectId, t]);

  return (
    <DropdownMenuGroup>
      {defaultToolInfo.map((tool) => {
        return (
          <DropdownMenuItem
            key={tool.id}
            className={cn(
              "cursor-pointer font-semibold text-xs text-muted-foreground",
              allowedAppDefaultToolkit?.includes(tool.id) && "text-foreground",
            )}
            onClick={(e) => {
              e.preventDefault();
              toggleAppDefaultToolkit(tool.id);
            }}
          >
            <tool.icon
              className={cn(
                "size-3.5",
                allowedAppDefaultToolkit?.includes(tool.id) &&
                  "text-foreground",
              )}
            />
            {tool.label}
            <Switch
              className="ml-auto"
              checked={allowedAppDefaultToolkit?.includes(tool.id)}
            />
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}
