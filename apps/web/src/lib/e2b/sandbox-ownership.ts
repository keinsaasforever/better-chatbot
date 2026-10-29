import "server-only";
import { Sandbox } from "@e2b/code-interpreter";
import { serverCache } from "lib/cache";
import { pgSandboxSessionRepository } from "lib/db/pg/repositories/sandbox-session-repository.pg";
import logger from "lib/logger";

/**
 * Ownership checks for sandbox-scoped routes.
 *
 * Every route that acts on a sandbox by ID must prove the caller owns it —
 * otherwise any authenticated user can drive another tenant's sandbox and,
 * via `/extend`, run up their bill.
 *
 * The one rule that matters here: **never establish ownership with
 * `Sandbox.connect()`**. Connect auto-resumes a paused sandbox ("If the
 * sandbox is paused, it will be automatically resumed" — SDK docs), so using
 * it to authorize a *pause* would wake a sandbox, start billing it, and grant
 * it a fresh auto-resume timeout, purely to put it back to sleep. Beacons
 * double-fire, so that is not a rare path.
 *
 * `Sandbox.getInfo` is a plain `GET /sandboxes/{id}` against the REST API with
 * no envd connection, so it reads a paused sandbox without waking it. Use it.
 */

/** Key `createSandbox` writes the owner under. See create-sandbox.ts. */
const OWNER_METADATA_KEY = "billingUserId";

const cacheKeyFor = (sandboxId: string) => `e2b:owner:${sandboxId}`;

/**
 * Sandbox IDs are never reused and an owner never changes, so a positive
 * result can be cached for a long time without ever widening access. A
 * negative result is cached only briefly: a sandbox that is still being
 * created can 404 momentarily.
 */
const OWNER_TTL_MS = 30 * 60 * 1000;
const MISS_TTL_MS = 30 * 1000;

/** Sentinel so a "no such sandbox" answer is cacheable distinctly from a miss. */
const NO_OWNER = "__none__";

/**
 * The user ID that created `sandboxId`, or null when the sandbox is unknown.
 *
 * Never connects, so it is safe to call against a paused sandbox.
 */
export async function getSandboxOwnerId(
  sandboxId: string,
): Promise<string | null> {
  const cacheKey = cacheKeyFor(sandboxId);

  try {
    const cached = await serverCache.get<string>(cacheKey);
    if (cached) return cached === NO_OWNER ? null : cached;
  } catch {
    // A cache miss costs one API call — never surface it.
  }

  // The registry is authoritative and one indexed read, so prefer it over a
  // round-trip to E2B. Falls through for sandboxes created before the registry
  // existed, which still carry the owner in their metadata.
  try {
    const row = await pgSandboxSessionRepository.findOwner(sandboxId);
    if (row?.userId) {
      await cacheOwner(cacheKey, row.userId);
      return row.userId;
    }
  } catch {
    // DB unavailable — fall back to E2B rather than failing the request.
  }

  let ownerId: string | null = null;
  try {
    const info = await Sandbox.getInfo(sandboxId, {
      apiKey: process.env.E2B_API_KEY,
    });
    ownerId = info.metadata?.[OWNER_METADATA_KEY] ?? null;
  } catch {
    // Not found / transient API error. Treat as "no owner" and let the caller
    // 403 — failing closed here is correct, and the short miss TTL means a
    // sandbox that was merely mid-creation recovers on the next call.
    ownerId = null;
  }

  await cacheOwner(cacheKey, ownerId);
  return ownerId;
}

async function cacheOwner(
  cacheKey: string,
  ownerId: string | null,
): Promise<void> {
  try {
    await serverCache.set(
      cacheKey,
      ownerId ?? NO_OWNER,
      ownerId ? OWNER_TTL_MS : MISS_TTL_MS,
    );
  } catch {
    // Non-fatal — the next call just repeats the lookup.
  }
}

/**
 * Whether `userId` may act on `sandboxId`.
 *
 * Fails **closed**: an unknown sandbox, missing metadata, or an API error all
 * return false. A sandbox route refusing to act is a recoverable annoyance;
 * acting on someone else's sandbox is not.
 */
export async function isSandboxOwner(
  sandboxId: string,
  userId: string,
): Promise<boolean> {
  const ownerId = await getSandboxOwnerId(sandboxId);
  if (ownerId && ownerId === userId) return true;

  logger.warn(
    `[e2b] ownership check refused sbxId=${sandboxId} caller=${userId} owner=${ownerId ?? "unknown"}`,
  );
  return false;
}
