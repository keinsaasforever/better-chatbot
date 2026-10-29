import "server-only";
import type { AgentFileBinding } from "app-types/agent";
import { CHAT_MESSAGE_WINDOW } from "lib/const";
import { chatRepository } from "lib/db/repository";
import { errorLabel } from "lib/e2b/create-sandbox";
import { serverFileStorage } from "lib/file-storage";
import logger from "lib/logger";
import {
  MAX_STAGED_FILE_BYTES,
  MAX_STAGED_FILES,
  MAX_STAGED_TOTAL_BYTES,
  dedupeStagedName,
  isUserOwnedStorageKey,
  sanitizeStagedFilename,
  storageKeyFromUrl,
} from "./storage-key";

// The pure helpers moved to ./storage-key so the browser can use them too;
// re-exported here because every server caller already imports from this file.
export {
  MAX_STAGED_FILE_BYTES,
  MAX_STAGED_FILENAME_BYTES,
  MAX_STAGED_FILES,
  MAX_STAGED_TOTAL_BYTES,
  dedupeStagedName,
  isUserOwnedStorageKey,
  sanitizeStagedFilename,
  storageKeyFromDownloadUrl,
  storageKeyFromUrl,
} from "./storage-key";

/** A file downloaded from storage, ready to be written into the sandbox. */
export type StagedFile = { filename: string; bytes: Buffer };

function attachmentUrl(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.toString();
  if (
    value &&
    typeof value === "object" &&
    "href" in value &&
    typeof value.href === "string"
  ) {
    return value.href;
  }
  return null;
}

/**
 * Collect the attachments of a thread as sandbox-ready files. Both the thread
 * and each storage key must belong to the caller. CSV/PDF uploads are persisted
 * as `source-url` + `title`, while native AI file parts can use either `url` or
 * `data`, so normalize all of those shapes here.
 */
export async function collectThreadAttachments(
  threadId: string,
  userId: string,
): Promise<StagedFile[]> {
  const hasAccess = await chatRepository.checkAccess(threadId, userId);
  if (!hasAccess) return [];

  const messages = await chatRepository.selectMessagesByThreadId(threadId, {
    limit: CHAT_MESSAGE_WINDOW,
  });

  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const files: StagedFile[] = [];
  let totalBytes = 0;

  // Prefer the newest attachment when separate turns reuse a visible filename;
  // model-authored code refers to the current turn's unsuffixed name.
  for (const message of [...messages].reverse()) {
    for (const part of message.parts ?? []) {
      if (files.length >= MAX_STAGED_FILES) return files;
      const candidate = part as {
        type?: string;
        url?: unknown;
        data?: unknown;
        filename?: unknown;
        title?: unknown;
      };
      if (candidate.type !== "file" && candidate.type !== "source-url") {
        continue;
      }

      const url = attachmentUrl(candidate.url) ?? attachmentUrl(candidate.data);
      if (!url) continue;

      const key = storageKeyFromUrl(url);
      if (!key || !isUserOwnedStorageKey(key, userId) || seenKeys.has(key)) {
        continue;
      }
      seenKeys.add(key);

      let bytes: Buffer;
      try {
        bytes = await serverFileStorage.download(key);
      } catch (err) {
        logger.warn(
          `[e2b] stage attachment download failed key=${key} error=${errorLabel(err)}`,
        );
        continue;
      }

      if (bytes.byteLength > MAX_STAGED_FILE_BYTES) {
        logger.warn(
          `[e2b] stage attachment skipped (over ${MAX_STAGED_FILE_BYTES}B) key=${key} bytes=${bytes.byteLength}`,
        );
        continue;
      }
      if (totalBytes + bytes.byteLength > MAX_STAGED_TOTAL_BYTES) return files;
      totalBytes += bytes.byteLength;

      const rawName =
        typeof candidate.filename === "string" && candidate.filename.length > 0
          ? candidate.filename
          : typeof candidate.title === "string" && candidate.title.length > 0
            ? candidate.title
            : key;
      const filename = dedupeStagedName(
        sanitizeStagedFilename(rawName),
        seenNames,
      );
      files.push({ filename, bytes });
    }
  }

  return files;
}

/**
 * Download the files bound to an agent so every run under that agent finds its
 * template and render script in the working directory.
 *
 * Ownership was verified when the binding was written, so the keys are read as
 * stored: a shared agent stages its owner's files for any org member allowed to
 * use it, exactly as it shares its owner's system prompt. Best-effort per file —
 * a template that has since been deleted must not break the whole run.
 */
export async function collectAgentFiles(
  files: AgentFileBinding[] | undefined,
): Promise<StagedFile[]> {
  if (!files?.length) return [];

  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();
  const staged: StagedFile[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (staged.length >= MAX_STAGED_FILES) break;
    if (seenKeys.has(file.storageKey)) continue;
    seenKeys.add(file.storageKey);

    let bytes: Buffer;
    try {
      bytes = await serverFileStorage.download(file.storageKey);
    } catch (err) {
      logger.warn(
        `[e2b] stage agent file download failed key=${file.storageKey} error=${errorLabel(err)}`,
      );
      continue;
    }

    if (bytes.byteLength > MAX_STAGED_FILE_BYTES) {
      logger.warn(
        `[e2b] stage agent file skipped (over ${MAX_STAGED_FILE_BYTES}B) key=${file.storageKey} bytes=${bytes.byteLength}`,
      );
      continue;
    }
    if (totalBytes + bytes.byteLength > MAX_STAGED_TOTAL_BYTES) break;
    totalBytes += bytes.byteLength;

    staged.push({
      filename: dedupeStagedName(
        sanitizeStagedFilename(file.filename),
        seenNames,
      ),
      bytes,
    });
  }

  return staged;
}

/**
 * Combine agent files with this thread's uploads for one sandbox run.
 *
 * The agent wins a name collision: its `template.html` keeps that exact name
 * and an upload of the same name is suffixed, because the agent's system prompt
 * documents those filenames and the model's code opens them literally. Total
 * caps are re-applied across the merged set.
 */
export function mergeStagedFiles(
  agentFiles: StagedFile[],
  threadFiles: StagedFile[],
): StagedFile[] {
  const seenNames = new Set<string>();
  const merged: StagedFile[] = [];
  let totalBytes = 0;

  for (const file of [...agentFiles, ...threadFiles]) {
    if (merged.length >= MAX_STAGED_FILES) break;
    if (totalBytes + file.bytes.byteLength > MAX_STAGED_TOTAL_BYTES) break;
    totalBytes += file.bytes.byteLength;
    merged.push({
      filename: dedupeStagedName(file.filename, seenNames),
      bytes: file.bytes,
    });
  }

  return merged;
}
