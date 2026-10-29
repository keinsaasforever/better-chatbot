"use client";

import { NodeKind } from "lib/ai/workflow/workflow.interface";
import { ReactNode, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { NodeIcon } from "./node-icon";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

const unSupportedKinds: NodeKind[] = [NodeKind.Code];

export function NodeSelect({
  children,
  onChange,
  open,
  onOpenChange,
}: {
  onChange: (nodeKind: NodeKind) => void;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="center" className="w-64">
        <NodeSelectContent onChange={onChange} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NodeSelectContent({
  onChange,
}: { onChange: (nodeKind: NodeKind) => void }) {
  const t = useTranslations();
  const descriptions = useMemo(() => {
    return t.raw("Workflow.kindsDescription") ?? {};
  }, [t]);
  return Object.keys(NodeKind)
    .filter((key) => NodeKind[key] !== NodeKind.Input)
    .sort((a, b) => {
      const aIndex = unSupportedKinds.indexOf(NodeKind[a]);
      const bIndex = unSupportedKinds.indexOf(NodeKind[b]);
      return aIndex - bIndex;
    })
    .map((key) => (
      <Tooltip key={key} delayDuration={0}>
        <TooltipTrigger asChild>
          <DropdownMenuItem
            disabled={unSupportedKinds.includes(NodeKind[key])}
            onClick={() => {
              if (unSupportedKinds.includes(NodeKind[key])) {
                return;
              }
              onChange(NodeKind[key]);
            }}
            key={key}
          >
            <NodeIcon type={NodeKind[key]} />
            {key}

            {unSupportedKinds.includes(NodeKind[key]) && (
              <span className="ml-auto text-xs text-muted-foreground">
                Soon...
              </span>
            )}
          </DropdownMenuItem>
        </TooltipTrigger>
        <TooltipContent side="left" align="center" className="max-w-64 p-4">
          <div className="flex items-center gap-2 mb-4">
            <NodeIcon type={NodeKind[key]} />
            <span className="text-sm font-semibold text-foreground">{key}</span>
          </div>
          <div className="whitespace-pre-wrap">
            {descriptions[NodeKind[key]] ?? "...soon"}
          </div>
        </TooltipContent>
      </Tooltip>
    ));
}
