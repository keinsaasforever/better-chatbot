"use client";
import type { WorkbookPreview } from "lib/file-ingest/xlsx";
import { fetcher } from "lib/utils";
import useSWR from "swr";

/** Why the preview is unavailable, as the sheet route reports it. */
export type SheetPreviewReason =
  | "invalid_key"
  | "unsupported"
  | "forbidden"
  | "too_large"
  | "not_found"
  | "unreadable";

export function sheetPreviewKey(storageKey: string): string {
  return `/api/storage/sheet?key=${encodeURIComponent(storageKey)}`;
}

/**
 * Parsed rows for a stored workbook.
 *
 * SWR's cache is the only caching layer here, and it is enough: re-opening the
 * same file in a session costs no network. Nothing is cached server-side on
 * purpose — `serverCache` is an in-process Map with no eviction, so holding
 * row arrays in it would leak a warm instance's heap for little gain.
 *
 * Pass a null key to skip the request entirely, which is how the panel avoids
 * fetching a workbook it already knows is too large.
 */
export function useSheetPreview(storageKey: string | null) {
  const { data, error, isLoading } = useSWR<WorkbookPreview>(
    storageKey ? sheetPreviewKey(storageKey) : null,
    fetcher,
    {
      revalidateOnFocus: false,
      // A failed parse fails the same way every time; one retry is plenty.
      errorRetryCount: 1,
      // Well past the app-wide 2s default: the panel arrives on a lazy
      // `ssr: false` chunk, and a workbook at a given key never changes — the
      // storage key carries a uuid, so a new file is a new key.
      dedupingInterval: 60_000,
    },
  );

  return {
    preview: data,
    isLoading,
    // `fetcher` puts the parsed body on the thrown error, so the panel can
    // tell "too large" from "broken" and say the right thing.
    reason:
      (error?.info?.reason as SheetPreviewReason | undefined) ?? undefined,
    isError: Boolean(error),
  };
}
