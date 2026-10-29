"use client";

import { appStore } from "@/app/store";
import { useSkills } from "@/hooks/queries/use-skills";
import type { SkillSummary } from "app-types/skill";
import { authClient } from "auth/client";
import { Search, Sparkles } from "lucide-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
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
import { SkillsSearchDialog } from "../skills/skills-search-dialog";

export function SkillSelector({
  onSelectSkill,
}: {
  onSelectSkill?: (skill: {
    id: string;
    name: string;
    description?: string;
    icon?: SkillSummary["icon"];
  }) => void;
}) {
  // Keep the store's skillList fresh for the chat "/" menu and this list.
  useSkills();
  const skillList = appStore((state) => state.skillList);
  const { data: session } = authClient.useSession();
  const currentUserId = session?.user?.id;
  const [searchOpen, setSearchOpen] = useState(false);

  const mySkills = skillList.filter((s) => s.userId === currentUserId);
  const sharedSkills = skillList.filter((s) => s.userId !== currentUserId);

  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-xs flex items-center gap-2 font-semibold cursor-pointer">
            <Sparkles className="size-3.5" />
            Skills
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className="w-[var(--radix-popper-available-width)] relative md:w-80">
              <DropdownMenuItem
                className="cursor-pointer text-muted-foreground"
                onSelect={(e) => {
                  e.preventDefault();
                  setSearchOpen(true);
                }}
              >
                <Search className="size-3.5" />
                <span>Search skills…</span>
              </DropdownMenuItem>

              {(mySkills.length > 0 || sharedSkills.length > 0) && (
                <DropdownMenuSeparator />
              )}

              {mySkills.length === 0 && sharedSkills.length === 0 ? (
                <div className="text-xs text-muted-foreground px-2 py-4 text-center">
                  No skills saved yet.
                </div>
              ) : (
                <>
                  {mySkills.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      onSelectSkill={onSelectSkill}
                    />
                  ))}
                  {mySkills.length > 0 && sharedSkills.length > 0 && (
                    <DropdownMenuSeparator />
                  )}
                  {sharedSkills.map((skill) => (
                    <SkillRow
                      key={skill.id}
                      skill={skill}
                      shared
                      onSelectSkill={onSelectSkill}
                    />
                  ))}
                </>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>

      <SkillsSearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  );
}

function SkillRow({
  skill,
  shared,
  onSelectSkill,
}: {
  skill: SkillSummary;
  shared?: boolean;
  onSelectSkill?: (skill: {
    id: string;
    name: string;
    description?: string;
    icon?: SkillSummary["icon"];
  }) => void;
}) {
  return (
    <DropdownMenuItem
      className="cursor-pointer"
      onClick={() =>
        onSelectSkill?.({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          icon: skill.icon,
        })
      }
    >
      {skill.icon && skill.icon.type === "emoji" ? (
        <div
          style={{ backgroundColor: skill.icon?.style?.backgroundColor }}
          className="p-1 rounded flex items-center justify-center ring ring-background border"
        >
          <Avatar className="size-3">
            <AvatarImage src={skill.icon?.value} />
            <AvatarFallback>{skill.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
        </div>
      ) : (
        <Sparkles className="size-3.5 text-muted-foreground" />
      )}
      <div className="flex items-center justify-between flex-1 min-w-0">
        <span className="truncate min-w-0">{skill.name}</span>
        {shared && skill.userName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="size-4 ml-2 shrink-0">
                <AvatarImage src={skill.userAvatar} />
                <AvatarFallback className="text-xs text-muted-foreground font-medium">
                  {skill.userName[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>Shared by {skill.userName}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </DropdownMenuItem>
  );
}
