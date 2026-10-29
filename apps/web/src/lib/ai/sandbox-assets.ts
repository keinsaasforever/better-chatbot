import type { UIMessage } from "ai";

export type SandboxAsset = {
  url: string;
  filename?: string;
  mediaType?: string;
};

/**
 * A long thread should not turn the whole prompt into a URL list. Newest wins,
 * because the file someone just uploaded is the one they are talking about.
 */
const MAX_ASSETS = 20;

/**
 * Pulls the URL off a file part.
 *
 * Two shapes exist in practice: UI message parts carry `url`, while the parts
 * built for the model carry `data` holding a URL object (see
 * `buildMessageParts` in app/api/chat/route-helpers.ts). Both end up persisted
 * in a thread, so read either. `data:` URIs are skipped — they are the inline
 * payload we are trying to get away from, and are useless to a sandbox.
 */
function readFileUrl(part: unknown): string | undefined {
  if (!part || typeof part !== "object") return undefined;
  const candidate =
    (part as { url?: unknown }).url ?? (part as { data?: unknown }).data;

  const url =
    typeof candidate === "string"
      ? candidate
      : candidate instanceof URL
        ? candidate.toString()
        : undefined;

  if (!url || !url.startsWith("http")) return undefined;
  return url;
}

/**
 * Every uploaded file still reachable in this thread, newest first.
 *
 * The asset list used to come from the current request's `attachments` alone,
 * which meant a user who uploaded an image in one turn and asked for a page in
 * the next got nothing — the model had no URL and asked them for one. Uploads
 * are folded into the message parts and persisted, so the whole thread is the
 * correct source.
 */
export function collectSandboxAssets(messages: UIMessage[]): SandboxAsset[] {
  const assets: SandboxAsset[] = [];
  const seen = new Set<string>();

  // Reverse: most recent message first, so the cap keeps what is most relevant
  // and the dedupe keeps the newest metadata for a repeated URL.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    for (const part of messages[i]?.parts ?? []) {
      if ((part as { type?: string })?.type !== "file") continue;

      const url = readFileUrl(part);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const { filename, mediaType } = part as {
        filename?: string;
        mediaType?: string;
      };
      assets.push({ url, filename, mediaType });

      if (assets.length >= MAX_ASSETS) return assets;
    }
  }

  return assets;
}
