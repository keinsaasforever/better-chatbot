import useSWR from "swr";
import { fetcher } from "lib/utils";

/**
 * Hook to check if user has Local Models Pro subscription
 *
 * Usage:
 *   const { hasAccess, isLoading } = useLocalModelsAccess();
 */
export function useLocalModelsAccess() {
  const { data, error, isLoading, mutate } = useSWR<{
    hasAccess: boolean;
    needsAuth?: boolean;
  }>("/api/user/local-models/access", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60000, // 1 minute
  });

  return {
    hasAccess: data?.hasAccess || false,
    needsAuth: data?.needsAuth || false,
    isLoading,
    error,
    mutate,
  };
}
