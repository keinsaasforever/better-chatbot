"use client";
import { appStore } from "@/app/store";
import { requireCredits } from "@/lib/billing/require-credits";
import { AudioWaveformIcon, PencilLine } from "lucide-react";
import { type PropsWithChildren, useState } from "react";
import { Command, CommandGroup, CommandItem, CommandList } from "ui/command";
import { Separator } from "ui/separator";
import { Popover, PopoverContent, PopoverTrigger } from "ui/popover";
import { useTranslations } from "next-intl";
import { generateUUID } from "lib/utils";
import { AgentSummary } from "app-types/agent";
import Link from "next/link";
import { authClient } from "auth/client";

type Props = PropsWithChildren<{
  agent: AgentSummary;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "end" | "center";
}>;

export function AgentDropdown({ agent, children, side, align }: Props) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const { data: session } = authClient.useSession();
  const isOwner = session?.user?.id === agent.userId;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0 w-[220px]" side={side} align={align}>
        <Command>
          <CommandList>
            <CommandGroup>
              <CommandItem className="cursor-pointer p-0">
                <div
                  className="flex items-center gap-2 w-full px-2 py-1 rounded"
                  onClick={() => {
                    if (!requireCredits()) return;
                    appStore.setState((state) => ({
                      voiceChat: {
                        ...state.voiceChat,
                        isOpen: true,
                        threadId: generateUUID(),
                        agentId: agent.id,
                      },
                    }));
                  }}
                >
                  <AudioWaveformIcon className="text-foreground" />
                  <span>{t("Chat.VoiceChat.title")}</span>
                </div>
              </CommandItem>
              {isOwner && (
                <CommandItem className="cursor-pointer p-0">
                  <Link
                    href={`/agent/${agent.id}`}
                    className="flex items-center gap-2 w-full px-2 py-1 rounded"
                  >
                    <PencilLine className="text-foreground" />
                    {t("Common.edit")}
                  </Link>
                </CommandItem>
              )}
            </CommandGroup>
            {!isOwner && agent.userName && (
              <>
                <Separator className="my-1" />
                <div className="px-2 py-1.5">
                  <p className="text-xs text-muted-foreground">
                    {t("Common.sharedBy", { userName: agent.userName })}
                  </p>
                </div>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
