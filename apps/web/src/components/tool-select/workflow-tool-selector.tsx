"use client";

import { appStore } from "@/app/store";
import { WorkflowSummary } from "app-types/workflow";
import { authClient } from "auth/client";
import { InfoIcon, MousePointer2, Waypoints } from "lucide-react";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Button } from "ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "ui/dialog";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { WorkflowGreeting } from "../workflow/workflow-greeting";

export function WorkflowToolSelector({
  onSelectWorkflow,
}: {
  onSelectWorkflow?: (workflow: WorkflowSummary) => void;
}) {
  const t = useTranslations();
  const workflowToolList = appStore((state) => state.workflowToolList);
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;

  // Separate user's workflows from shared workflows
  const myWorkflows = workflowToolList.filter(
    (w) => w.userId === currentUserId,
  );
  const sharedWorkflows = workflowToolList.filter(
    (w) => w.userId !== currentUserId,
  );
  return (
    <DropdownMenuGroup>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="text-xs flex items-center gap-2 font-semibold cursor-pointer">
          <Waypoints className="size-3.5" />
          {t("Workflow.title")}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent className="w-[var(--radix-popper-available-width)] relative md:w-80">
            {myWorkflows.length === 0 && sharedWorkflows.length === 0 ? (
              <div className="text-sm text-muted-foreground flex flex-col py-6 px-6 gap-4 items-center">
                <InfoIcon className="size-4" />
                <p className="whitespace-pre-wrap">{t("Workflow.noTools")}</p>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant={"ghost"} className="relative group">
                      {t("Workflow.whatIsWorkflow")}
                      <div className="absolute left-0 -top-1.5 opacity-100 group-hover:opacity-0 transition-opacity duration-300">
                        <MousePointer2 className="rotate-180 text-blue-500 fill-blue-500 size-3 wiggle" />
                      </div>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="md:max-w-3xl!">
                    <DialogTitle className="sr-only">
                      workflow greeting
                    </DialogTitle>
                    <WorkflowGreeting />
                  </DialogContent>
                </Dialog>
              </div>
            ) : (
              <>
                {/* My Workflows */}
                {myWorkflows.map((workflow) => (
                  <DropdownMenuItem
                    key={workflow.id}
                    className="cursor-pointer"
                    onClick={() => onSelectWorkflow?.(workflow)}
                  >
                    {workflow.icon && workflow.icon.type === "emoji" ? (
                      <div
                        style={{
                          backgroundColor:
                            workflow.icon?.style?.backgroundColor,
                        }}
                        className="p-1 rounded flex items-center justify-center ring ring-background border"
                      >
                        <Avatar className="size-3">
                          <AvatarImage src={workflow.icon?.value} />
                          <AvatarFallback>
                            {workflow.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    ) : null}
                    <span className="truncate min-w-0">{workflow.name}</span>
                  </DropdownMenuItem>
                ))}

                {myWorkflows.length > 0 && sharedWorkflows.length > 0 && (
                  <DropdownMenuSeparator />
                )}

                {/* Shared Workflows */}
                {sharedWorkflows.map((workflow) => (
                  <DropdownMenuItem
                    key={workflow.id}
                    className="cursor-pointer"
                    onClick={() => onSelectWorkflow?.(workflow)}
                  >
                    {workflow.icon && workflow.icon.type === "emoji" ? (
                      <div
                        style={{
                          backgroundColor:
                            workflow.icon?.style?.backgroundColor,
                        }}
                        className="p-1 rounded flex items-center justify-center ring ring-background border"
                      >
                        <Avatar className="size-3">
                          <AvatarImage src={workflow.icon?.value} />
                          <AvatarFallback>
                            {workflow.name.slice(0, 1)}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between flex-1 min-w-0">
                      <span className="truncate min-w-0">{workflow.name}</span>
                      {workflow.userName && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Avatar className="size-4 ml-2 shrink-0">
                              <AvatarImage src={workflow.userAvatar} />
                              <AvatarFallback className="text-xs text-muted-foreground font-medium">
                                {workflow.userName[0]?.toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("Common.sharedBy", {
                              userName: workflow.userName,
                            })}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
    </DropdownMenuGroup>
  );
}
