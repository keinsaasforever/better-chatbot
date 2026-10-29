"use client";

import { appStore } from "@/app/store";
import {
  getShortcutKeyList,
  isShortcutEvent,
  Shortcuts,
} from "lib/keyboard-shortcuts";
import {
  Check,
  CheckIcon,
  ClipboardCheck,
  Infinity,
  ListTodo,
  PenOff,
  Settings2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "ui/button";
import { useTranslations } from "next-intl";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";

import { useShallow } from "zustand/shallow";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

import { capitalizeFirstLetter, cn, createDebounce } from "lib/utils";

export const ToolModeDropdown = ({
  disabled,
  className,
  compact,
}: { disabled?: boolean; className?: string; compact?: boolean }) => {
  const t = useTranslations("Chat.Tool");
  const debounce = useMemo(() => createDebounce(), []);
  const [toolChoice, planMode, appStoreMutate] = appStore(
    useShallow((state) => [state.toolChoice, state.planMode, state.mutate]),
  );
  const [open, setOpen] = useState(false);

  const [toolChoiceChangeInfo, setToolChoiceChangeInfo] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isShortcutEvent(e, Shortcuts.toolMode)) {
        e.preventDefault();
        e.stopPropagation();
        appStoreMutate(({ toolChoice }) => {
          return {
            toolChoice:
              toolChoice == "auto"
                ? "manual"
                : toolChoice == "manual"
                  ? "none"
                  : "auto",
          };
        });
        setToolChoiceChangeInfo(true);
        debounce(() => {
          setToolChoiceChangeInfo(false);
        }, 1000);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <div className={cn("relative", className)}>
          <Tooltip open={toolChoiceChangeInfo}>
            <TooltipTrigger asChild>
              <span className="absolute inset-0 -z-10" />
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2">
              {capitalizeFirstLetter(toolChoice)}
              <CheckIcon className="size-2.5" />
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={"ghost"}
                size={"sm"}
                className={cn(
                  "rounded-full data-[state=open]:bg-input! hover:bg-input!",
                  compact ? "size-7 p-0" : "p-2!",
                  toolChoice == "none" && "text-muted-foreground",
                  planMode && "text-primary",
                  open && "bg-input!",
                )}
                onClick={() => setOpen(true)}
              >
                <Settings2 className={compact ? "size-3.5" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="flex items-center gap-2" side="top">
              {t("selectToolMode")}
              <span className="text-muted-foreground ml-2">
                {getShortcutKeyList(Shortcuts.toolMode).join("")}
              </span>
            </TooltipContent>
          </Tooltip>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        collisionPadding={{ top: 12, bottom: 88 }}
      >
        <DropdownMenuLabel className="text-muted-foreground flex items-center gap-2">
          {t("selectToolMode")}
          <DropdownMenuShortcut>
            <span className="text-xs text-muted-foreground bg-muted rounded-md px-2 py-0.5">
              {getShortcutKeyList(Shortcuts.toolMode).join("")}
            </span>
          </DropdownMenuShortcut>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => appStoreMutate({ toolChoice: "auto" })}
          >
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2">
                <Infinity />
                <span className="font-bold">Auto</span>
                {toolChoice == "auto" && <Check className="ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("autoToolModeDescription")}
              </p>
            </div>
          </DropdownMenuItem>
          <div className="px-2 py-1">
            <DropdownMenuSeparator />
          </div>
          <DropdownMenuItem
            onClick={() => appStoreMutate({ toolChoice: "manual" })}
          >
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2">
                <ClipboardCheck />
                <span className="font-bold">Manual</span>
                {toolChoice == "manual" && <Check className="ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("manualToolModeDescription")}
              </p>
            </div>
          </DropdownMenuItem>
          <div className="px-2 py-1">
            <DropdownMenuSeparator />
          </div>
          <DropdownMenuItem
            onClick={() => appStoreMutate({ toolChoice: "none" })}
          >
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2">
                <PenOff />
                <span className="font-bold">None</span>
                <span className="text-xs text-muted-foreground ml-4">
                  @mention only
                </span>
                {toolChoice == "none" && <Check className="ml-auto" />}
              </div>

              <p className="text-xs text-muted-foreground">
                {t("noneToolModeDescription")}
              </p>
            </div>
          </DropdownMenuItem>
          <div className="px-2 py-1">
            <DropdownMenuSeparator />
          </div>
          <DropdownMenuItem
            onClick={() =>
              appStoreMutate((state) => ({ planMode: !state.planMode }))
            }
          >
            <div className="flex flex-col gap-2 w-full">
              <div className="flex items-center gap-2">
                <ListTodo className={cn(planMode && "text-primary")} />
                <span className="font-bold">Plan</span>
                {planMode && <Check className="ml-auto" />}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("planToolModeDescription")}
              </p>
            </div>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
