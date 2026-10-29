import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { auth } from "lib/auth/auth-instance";
import { pgDb } from "lib/db/pg/db.pg";
import { ApiKeyTable } from "lib/db/pg/schema.pg";
import { isUserMemberOfOrganization } from "lib/organization/members";
import globalLogger from "logger";
import type { ToolActor } from "./types";

const logger = globalLogger.withDefaults({ message: "Navigator API keys: " });

/**
 * Navigator API keys: bearer credentials for `/api/navigator-mcp`.
 *
 * Minted and verified by the Better Auth `apiKey` plugin (hashed at rest,
 * shown once, rate limited per key). Each key belongs to a user and carries
 * the organization it acts in as `metadata.organizationId` — the active
 * organization at the moment it was created, or none.
 */

type KeyMetadata = { organizationId?: unknown } | null | undefined;

function organizationOf(metadata: unknown): string | null {
  if (typeof metadata === "string") {
    try {
      return organizationOf(JSON.parse(metadata));
    } catch {
      return null;
    }
  }
  const value = (metadata as KeyMetadata)?.organizationId;
  return typeof value === "string" && value ? value : null;
}

export type NavigatorApiKeySummary = {
  id: string;
  name: string | null;
  /** The first characters of the key, for telling keys apart. Never the key. */
  start: string | null;
  organizationId: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

export async function listNavigatorApiKeys(
  userId: string,
): Promise<NavigatorApiKeySummary[]> {
  const rows = await pgDb
    .select({
      id: ApiKeyTable.id,
      name: ApiKeyTable.name,
      start: ApiKeyTable.start,
      metadata: ApiKeyTable.metadata,
      createdAt: ApiKeyTable.createdAt,
      expiresAt: ApiKeyTable.expiresAt,
      lastRequest: ApiKeyTable.lastRequest,
    })
    .from(ApiKeyTable)
    .where(eq(ApiKeyTable.referenceId, userId))
    .orderBy(desc(ApiKeyTable.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    start: row.start,
    organizationId: organizationOf(row.metadata),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastRequest?.toISOString() ?? null,
  }));
}

/**
 * Mint a key for a user, scoped to an organization they belong to. Returns the
 * plaintext key exactly once; only its hash is stored.
 */
export async function createNavigatorApiKey(input: {
  userId: string;
  organizationId: string | null;
  name: string;
  expiresInDays?: number;
}): Promise<NavigatorApiKeySummary & { key: string }> {
  const created = await auth.api.createApiKey({
    body: {
      userId: input.userId,
      name: input.name,
      metadata: { organizationId: input.organizationId },
      expiresIn: input.expiresInDays
        ? input.expiresInDays * 24 * 60 * 60
        : null,
    },
  });
  return {
    id: created.id,
    key: created.key,
    name: created.name ?? input.name,
    start: created.start ?? null,
    organizationId: input.organizationId,
    createdAt: new Date(created.createdAt).toISOString(),
    expiresAt: created.expiresAt
      ? new Date(created.expiresAt).toISOString()
      : null,
    lastUsedAt: null,
  };
}

/** Delete one of the user's own keys. False when it is not theirs or gone. */
export async function revokeNavigatorApiKey(
  userId: string,
  keyId: string,
): Promise<boolean> {
  const deleted = await pgDb
    .delete(ApiKeyTable)
    .where(and(eq(ApiKeyTable.id, keyId), eq(ApiKeyTable.referenceId, userId)))
    .returning({ id: ApiKeyTable.id });
  return deleted.length > 0;
}

export type ApiKeyVerification =
  | { ok: true; actor: ToolActor }
  | { ok: false; reason: "invalid" | "rate_limited" | "forbidden" };

/**
 * Verify a bearer key and build the actor it acts as.
 *
 * The organization is never trusted from the key alone: membership is checked
 * on every call, so removing someone from an organization (or the user
 * leaving it) disables their keys for it at once. A key minted without an
 * organization acts with `organizationId: null`, which every tool treats as
 * owner-only.
 */
export async function verifyNavigatorApiKey(
  key: string,
): Promise<ApiKeyVerification> {
  let result: Awaited<ReturnType<typeof auth.api.verifyApiKey>>;
  try {
    result = await auth.api.verifyApiKey({ body: { key } });
  } catch (error) {
    logger.warn("Key verification failed:", error);
    return { ok: false, reason: "invalid" };
  }
  if (!result.valid || !result.key) {
    return {
      ok: false,
      reason:
        result.error?.code === "RATE_LIMITED" ? "rate_limited" : "invalid",
    };
  }

  const userId = result.key.referenceId;
  const organizationId = organizationOf(result.key.metadata);
  if (
    organizationId &&
    !(await isUserMemberOfOrganization(organizationId, userId))
  ) {
    return { ok: false, reason: "forbidden" };
  }
  return { ok: true, actor: { userId, organizationId, source: "mcp" } };
}
