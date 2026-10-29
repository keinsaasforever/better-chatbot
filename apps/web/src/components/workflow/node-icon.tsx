"use client";

import { NodeKind } from "lib/ai/workflow/workflow.interface";
import { cn } from "lib/utils";
import {
  BotIcon,
  BoxIcon,
  HardDriveUpload,
  HouseIcon,
  InfoIcon,
  LandPlotIcon,
  SplitIcon,
  TerminalIcon,
  TextIcon,
  WrenchIcon,
} from "lucide-react";
import { useMemo } from "react";

export function NodeIcon({
  type,
  className,
  iconClassName,
}: { type: NodeKind; className?: string; iconClassName?: string }) {
  const Icon = useMemo(() => {
    switch (type) {
      case NodeKind.Input:
        return HouseIcon;
      case NodeKind.Output:
        return LandPlotIcon;
      case NodeKind.Note:
        return InfoIcon;
      case NodeKind.Tool:
        return WrenchIcon;
      case NodeKind.LLM:
        return BotIcon;
      case NodeKind.Condition:
        return SplitIcon;
      case NodeKind.Http:
        return HardDriveUpload;
      case NodeKind.Template:
        return TextIcon;
      case NodeKind.Code:
        return TerminalIcon;
      default:
        return BoxIcon;
    }
  }, [type]);

  return (
    <div
      className={cn(
        type === NodeKind.Input
          ? "bg-blue-500"
          : type === NodeKind.Output
            ? "bg-green-500"
            : type === NodeKind.Note
              ? "text-foreground bg-input"
              : type === NodeKind.LLM
                ? "bg-indigo-500"
                : type === NodeKind.Tool
                  ? "bg-blue-500"
                  : type === NodeKind.Code || type === NodeKind.Http
                    ? "bg-rose-500"
                    : type === NodeKind.Template
                      ? "bg-purple-500"
                      : type === NodeKind.Condition
                        ? "bg-amber-500"
                        : "bg-card",
        "p-1 rounded",
        className,
      )}
    >
      <Icon className={cn("size-4 text-white", iconClassName)} />
    </div>
  );
}
