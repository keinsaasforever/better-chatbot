import { fetcher } from "lib/utils";
import useSWR, { SWRConfiguration } from "swr";
import { ModelMetadata } from "@/types/model";

/**
 * Hook to fetch model metadata from the database
 *
 * Returns models with text=true including:
 * - Developer grouping
 * - Badge flags (hiddenGem, speed, thinking, etc.)
 * - Pricing information
 * - Descriptions
 *
 * Used by the enhanced model selector component
 */
export const useModelsMetadata = (options?: SWRConfiguration) => {
  return useSWR<ModelMetadata[]>("/api/models/metadata", fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000 * 10, // 10 minutes cache
    fallbackData: [],
    ...options,
  });
};
