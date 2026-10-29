"use client";
import type { PptxPreview } from "lib/file-ingest/pptx";
import type { TextExtract } from "lib/file-ingest/text";
import { fetcher } from "lib/utils";
import useSWR from "swr";

/** Why the preview is unavailable, as the document route reports it. */
export type DocumentPreviewReason =
  | "invalid_key"
  | "unsupported"
  | "forbidden"
  | "disabled"
  | "too_large"
  | "not_found"
  | "unreadable";

export type DocumentPreviewBody =
  | { kind: "document"; html: string; truncated: boolean }
  | ({ kind: "slides" } & PptxPreview)
  | ({ kind: "text" } & TextExtract);

export function documentPreviewKey(storageKey: string): string {
  return `/api/storage/document?key=${encodeURIComponent(storageKey)}`;
}

/**
 * A stored .docx, .pptx or text file, rendered server-side.
 *
 * Mirrors `use-sheet-preview` deliberately, down to the deduping interval: the
 * panel arrives on a lazy chunk, and a file at a given key never changes,
 * because the key carries a uuid — a new file is a new key. SWR's cache is the
 * only caching layer, which is enough and leaks nothing on a warm instance.
 */
export function useDocumentPreview(storageKey: string | null) {
  const { data, error, isLoading } = useSWR<DocumentPreviewBody>(
    storageKey ? documentPreviewKey(storageKey) : null,
    fetcher,
    {
      revalidateOnFocus: false,
      // A failed parse fails the same way every time; one retry is plenty.
      errorRetryCount: 1,
      dedupingInterval: 60_000,
    },
  );

  return {
    preview: data,
    isLoading,
    // `fetcher` puts the parsed body on the thrown error, so the panel can
    // tell "too large" from "broken" and say the right thing.
    reason:
      (error?.info?.reason as DocumentPreviewReason | undefined) ?? undefined,
    isError: Boolean(error),
  };
}
