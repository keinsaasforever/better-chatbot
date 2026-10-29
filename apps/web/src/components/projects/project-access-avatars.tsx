"use client";

import { useState } from "react";
import { Plus, UserRound, Bot } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Button } from "ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useProjectMembers } from "@/hooks/queries/use-project-members";
import { ProjectCollaboratorsDialog } from "./project-collaborators-dialog";

export function ProjectAccessAvatars({
  projectId,
  role,
}: {
  projectId: string;
  role?: "owner" | "editor" | "viewer";
}) {
  const [open, setOpen] = useState(false);
  const [defaultTab, setDefaultTab] = useState<
    "people" | "agents" | "workflows"
  >("people");
  const { data } = useProjectMembers(projectId);
  const members = data?.members ?? [];
  const canEdit = role !== "viewer";

  const openTab = (tab: "people" | "agents" | "workflows") => {
    setDefaultTab(tab);
    setOpen(true);
  };

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            onClick={() => openTab("agents")}
          >
            <Bot className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Project agents</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="relative rounded-full"
            onClick={() => openTab("people")}
          >
            {members.length > 0 ? (
              <div className="flex -space-x-2">
                {members.slice(0, 3).map((member) => (
                  <Avatar
                    key={member.id}
                    className="size-5 border border-background"
                  >
                    <AvatarImage src={member.image ?? undefined} />
                    <AvatarFallback className="text-[9px]">
                      {(member.name || member.email || "?")
                        .slice(0, 1)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
            ) : (
              <UserRound className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Project people</TooltipContent>
      </Tooltip>
      <Button
        variant="default"
        size="icon"
        className="rounded-full"
        onClick={() => openTab("people")}
      >
        <Plus className="size-4" />
      </Button>
      <ProjectCollaboratorsDialog
        projectId={projectId}
        open={open}
        onOpenChange={setOpen}
        defaultTab={defaultTab}
        canEdit={canEdit}
      />
    </div>
  );
}
