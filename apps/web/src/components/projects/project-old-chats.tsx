"use client";

import { fetcher } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { ChevronRight, MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import useSWR from "swr";

export function ProjectOldChats({
  projectId,
  selectedThreadId,
}: {
  projectId: string;
  selectedThreadId?: string | null;
  onSelectThread?: (threadId: string) => void;
}) {
  const t = useTranslations("Layout");
  const { data: threads = [] } = useSWR<
    Array<{
      id: string;
      title: string;
      createdAt: string;
      lastMessageAt?: string;
    }>
  >(`/api/projects/${projectId}/threads`, fetcher);

  if (!threads.length) return null;

  return (
    <section className="mx-auto w-full max-w-3xl rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <MessageSquare className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Chats in this project</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {threads.length}
        </span>
      </div>
      <ul className="max-h-72 divide-y overflow-y-auto">
        {threads.map((thread) => (
          <li key={thread.id}>
            <Link
              href={`/chat/${thread.id}`}
              className={cn(
                "flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/50",
                selectedThreadId === thread.id && "bg-muted font-medium",
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {thread.title || t("newChat")}
              </span>
              {thread.lastMessageAt || thread.createdAt ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(
                    thread.lastMessageAt ?? thread.createdAt,
                  ).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              ) : null}
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
