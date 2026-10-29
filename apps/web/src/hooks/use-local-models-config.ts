import useSWR from "swr";
import { fetcher } from "lib/utils";

export interface LocalModelsConfig {
  enabled: boolean;
  type: "ollama" | "lmstudio" | "openai_compatible";
  baseUrl: string;
  /** Never contains the raw key — GET endpoint strips it and returns hasApiKey instead */
  hasApiKey?: boolean;
  models: Array<{
    id: string;
    name: string;
    size?: number;
    details?: any;
  }>;
  lastSync: string;
}

/**
 * Hook to get user's local models configuration
 * Models auto-refresh on page load (no manual refresh needed)
 *
 * Usage:
 *   const { config, isLoading, mutate } = useLocalModelsConfig();
 */
export function useLocalModelsConfig() {
  const { data, error, isLoading, mutate } = useSWR<{
    config: LocalModelsConfig | null;
  }>("/api/user/local-models/config", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    // See use-knowledge-bases: lazily-mounted dialogs re-mount this hook well
    // after boot, past the app-wide 2s deduping default.
    dedupingInterval: 60_000,
  });

  return {
    config: data?.config || null,
    isLoading,
    error,
    mutate,
  };
}
