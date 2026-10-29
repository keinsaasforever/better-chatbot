"use client";

import { useState } from "react";
import { useSWRConfig } from "swr";

export interface BookmarkItem {
  id: string;
  isBookmarked?: boolean;
}

interface UseBookmarkOptions {
  itemType?: "agent" | "workflow" | "mcp";
}

export function useBookmark(options: UseBookmarkOptions = {}) {
  const { itemType = "agent" } = options;
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const { mutate } = useSWRConfig();

  const toggleBookmark = async (item: BookmarkItem) => {
    const { id, isBookmarked = false } = item;

    if (loadingIds.has(id)) return;

    setLoadingIds((prev) => new Set(prev).add(id));

    try {
      // Make the API call to the generic bookmark endpoint
      const response = await fetch(`/api/bookmark`, {
        method: isBookmarked ? "DELETE" : "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          itemId: id,
          itemType,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update bookmark");
      }

      // Update all list caches with optimistic data
      await mutate(
        (key) => {
          if (typeof key !== "string") return false;
          // Update list endpoints but not individual item details
          return (
            key.startsWith(`/api/${itemType}`) &&
            !key.match(new RegExp(`/api/${itemType}/[^/?]+$`))
          );
        },
        (cachedData: any) => {
          if (!cachedData) return cachedData;

          // Handle arrays of items (like /api/agent?filters=...)
          if (Array.isArray(cachedData)) {
            return cachedData.map((item: any) =>
              item.id === id ? { ...item, isBookmarked: !isBookmarked } : item,
            );
          }

          // Handle single item objects (like some search endpoints)
          if (cachedData.id === id) {
            return { ...cachedData, isBookmarked: !isBookmarked };
          }

          return cachedData;
        },
        { revalidate: true },
      );

      // Also update individual item cache
      await mutate(
        `/api/${itemType}/${id}`,
        (cachedData: any) => {
          if (!cachedData) return cachedData;
          return { ...cachedData, isBookmarked: !isBookmarked };
        },
        { revalidate: true },
      );

      return !isBookmarked; // Return new bookmark state
    } catch (error) {
      console.error("Error toggling bookmark:", error);
      throw error;
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  return {
    toggleBookmark,
    isLoading: (itemId: string) => loadingIds.has(itemId),
  };
}
