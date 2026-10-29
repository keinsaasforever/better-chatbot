/**
 * Turn a client-supplied attachment URL into a storage key this user may read.
 *
 * The attachment array arrives in the request body and `ChatAttachmentSchema`
 * types `url` as a plain string, so every value here is attacker-controlled.
 * Two things used to go wrong together:
 *
 *  - `lib/file-storage/storage-utils.ts`'s `storageKeyFromUrl` fell back to the
 *    raw pathname for any URL it did not recognise, so *any* URL became a key.
 *  - The chat route handed the ingesters `serverFileStorage.download` with no
 *    user, and that client holds the service role.
 *
 * Together they let a crafted `attachments[].url` naming another user's object
 * have its text extracted into this user's model context. Every other read
 * path already guarded itself — `stage-attachments.ts`, `/api/storage/ingest`,
 * `/api/storage/download` all check the owner prefix — chat ingestion was the
 * one that did not.
 *
 * The strict parser from `lib/code-runner/storage-key.ts` is reused rather than
 * a second implementation: it requires the attachments bucket and returns null
 * for anything else, and it is already covered by `storage-key.test.ts`.
 */

import {
  isUserOwnedStorageKey,
  storageKeyFromDownloadUrl,
} from "lib/code-runner/storage-key";
import type { UnavailableReason } from "./outcome";

export type OwnedKeyResult =
  | { ok: true; key: string }
  | { ok: false; reason: UnavailableReason };

/**
 * `bad_url` and `not_owner` are separate here only so the server can log which
 * one happened. Callers must collapse both into the same `unavailable` result:
 * telling them apart would answer "does this key exist and is it mine?" for an
 * arbitrary key.
 */
export function resolveOwnedAttachmentKey(
  url: string | undefined,
  userId: string,
): OwnedKeyResult {
  if (!url) return { ok: false, reason: "bad_url" };

  const key = storageKeyFromDownloadUrl(url);
  if (!key) return { ok: false, reason: "bad_url" };

  if (!isUserOwnedStorageKey(key, userId)) {
    return { ok: false, reason: "not_owner" };
  }

  return { ok: true, key };
}
