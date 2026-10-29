"use client";
import { appStore } from "@/app/store";
import { SkillSummary } from "app-types/skill";
import { fetcher } from "lib/utils";
import useSWR, { SWRConfiguration } from "swr";
import { handleErrorWithToast } from "ui/shared-toast";

interface UseSkillsOptions extends SWRConfiguration {
  type?: "all" | "mine" | "shared";
  limit?: number;
}

export function useSkills(options: UseSkillsOptions = {}) {
  const { type = "all", limit = 100, ...swrOptions } = options;

  const queryParams = new URLSearchParams({
    type,
    limit: limit.toString(),
  });

  const {
    data: skills = [],
    error,
    isLoading,
    mutate,
  } = useSWR<SkillSummary[]>(`/api/skills?${queryParams.toString()}`, fetcher, {
    errorRetryCount: 0,
    revalidateOnFocus: false,
    fallbackData: [],
    onError: handleErrorWithToast,
    onSuccess: (data) => {
      // Update Zustand store for chat mentions / tool menu.
      appStore.setState({ skillList: data });
    },
    ...swrOptions,
  });

  return { skills, isLoading, error, mutate };
}
