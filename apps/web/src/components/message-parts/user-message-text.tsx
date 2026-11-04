"use client";

import { appStore } from "@/app/store";
import {
  type MessageMentionPart,
  parseMessageMentions,
} from "lib/chat/message-mentions";
import { HammerIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";

function MentionChip({ mention }: { mention: MessageMentionPart }) {
  const agent = appStore((state) =>
    mention.type === "agent"
      ? state.agentList.find((item) => item.name === mention.name)
      : undefined,
  );
  // The composer currently serializes workflows as @tool("name") too.
  const workflow = appStore((state) =>
    mention.type !== "agent"
      ? state.workflowToolList.find((item) => item.name === mention.name)
      : undefined,
  );
  const icon = agent?.icon ?? workflow?.icon;

  return (
    <span
      data-mention-type={mention.type}
      className="inline-flex max-w-full items-center gap-1 rounded-sm bg-primary/10 px-1.5 py-0.5 align-middle font-semibold text-primary"
    >
      {mention.type === "tool" && !workflow ? (
        <HammerIcon aria-hidden="true" className="size-3.5 shrink-0" />
      ) : (
        <Avatar
          aria-hidden="true"
          style={icon?.style}
          className="size-3.5 shrink-0 rounded-full ring-1 ring-input"
        >
          <AvatarImage src={icon?.value} alt="" />
          <AvatarFallback>{mention.name.slice(0, 1)}</AvatarFallback>
        </Avatar>
      )}
      <span className="min-w-0 whitespace-pre-wrap break-words">
        @{mention.name}
      </span>
    </span>
  );
}

export function UserMessageText({ text }: { text: string }) {
  return parseMessageMentions(text).map((part) =>
    part.type === "text" ? (
      part.text
    ) : (
      <MentionChip key={part.start} mention={part} />
    ),
  );
}
