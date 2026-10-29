import type { Buffer } from "node:buffer";

/**
 * What every ingester needs from the request, and nothing more.
 *
 * `userId` is not a convenience: the attachment array arrives in the request
 * body, so each `url` is attacker-controlled, and the storage client the
 * `download` below closes over holds the service role. Owning the thread is
 * not enough — a forged attachment inside an owned thread must not be able to
 * name another user's object. See `./owned-key.ts`.
 */
export type IngestContext = {
  userId: string;
};

/** Fetch an object by storage key. Callers pass one already checked for ownership. */
export type DownloadFile = (key: string) => Promise<Buffer>;
