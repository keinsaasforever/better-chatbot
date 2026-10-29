"use client";
import useSWR from "swr";
import { fetcher } from "lib/utils";
import type { KnowledgeBaseEntity } from "@/lib/db/pg/schema.pg";

export type KnowledgeBaseSummary = Omit<
  KnowledgeBaseEntity,
  "createdAt" | "updatedAt"
> & {
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeBaseProjectTarget = {
  id: string;
  name: string;
  agentsetNamespaceId: string | null;
};

type KnowledgeBasesResponse = {
  knowledgeBases: KnowledgeBaseSummary[];
  projects: KnowledgeBaseProjectTarget[];
};

export function useKnowledgeBases() {
  const { data, isLoading, mutate } = useSWR<KnowledgeBasesResponse>(
    "/api/knowledge-bases",
    fetcher,
    {
      revalidateOnFocus: false,
      errorRetryCount: 1,
      // Well past the app-wide 2s default: this hook is mounted by dialogs that
      // arrive on lazy `ssr: false` chunks, so a second mount lands seconds
      // after boot and would otherwise re-hit the network. Explicit `mutate()`
      // after a write still revalidates immediately.
      dedupingInterval: 60_000,
    },
  );

  return {
    knowledgeBases: data?.knowledgeBases ?? [],
    projects: data?.projects ?? [],
    isLoading,
    mutate,
  };
}
