import "server-only";

import { and, eq } from "drizzle-orm";
import {
  SecretBoxUnavailableError,
  isSecretBoxAvailable,
  open,
  seal,
} from "lib/crypto/secret-box";
import { pgDb } from "lib/db/pg/db.pg";
import { MemberTable, OrganizationTable } from "lib/db/pg/schema.pg";
import type { CockpitConnectionEntity } from "lib/db/pg/schema.pg";
import { cockpitConnectionRepository } from "lib/db/repository";
import logger from "logger";
import {
  PROVIDERS,
  type RedactedConfig,
  mergeSubmittedConfig,
  parseConfig,
  prepareProvider,
  probeProvider,
  redactConfig,
} from "./providers";
import type { ProbeResult } from "./providers/types";
import { reason } from "./reasons";
import type { CockpitProvider } from "./types";

export type CockpitScope = { userId: string; organizationId: string | null };

export type CockpitAccess = CockpitScope & {
  /**
   * Whether the user may add, change or remove connections. Personal scope:
   * always. Organization scope: owners and admins only, since a connection
   * is shared with (and its data visible to) every member.
   */
  canManage: boolean;
};

export async function resolveCockpitAccess(
  scope: CockpitScope,
): Promise<CockpitAccess> {
  if (!scope.organizationId) return { ...scope, canManage: true };
  const [member] = await pgDb
    .select({ role: MemberTable.role })
    .from(MemberTable)
    .where(
      and(
        eq(MemberTable.organizationId, scope.organizationId),
        eq(MemberTable.userId, scope.userId),
      ),
    )
    .limit(1);
  const roles = (member?.role ?? "").split(",").map((r) => r.trim());
  return {
    ...scope,
    canManage: roles.includes("owner") || roles.includes("admin"),
  };
}

/**
 * The identity a connection's providers run under: its owner in its
 * workspace, the same for the probe on save and every later refresh, so a
 * test cannot pass with access the feed will not have.
 */
function ownerScope(
  row: Pick<CockpitConnectionEntity, "userId" | "organizationId">,
): CockpitScope {
  return { userId: row.userId, organizationId: row.organizationId };
}

/** Decrypts a stored config; null when it cannot be opened or parsed. */
export function openConfig(
  row: Pick<CockpitConnectionEntity, "provider" | "configEncrypted">,
): Record<string, unknown> | null {
  try {
    const raw = open<Record<string, unknown>>(row.configEncrypted);
    return (parseConfig(row.provider as CockpitProvider, raw) ??
      null) as Record<string, unknown> | null;
  } catch (error) {
    // Never log the payload; the error type is enough to diagnose a key change.
    logger.warn(
      "[cockpit] could not open connection config",
      row.provider,
      error instanceof Error ? error.name : "unknown",
    );
    return null;
  }
}

export type ConnectionView = {
  id: string;
  provider: CockpitProvider;
  label: string | null;
  enabled: boolean;
  lastOkAt: string | null;
  lastError: string | null;
  updatedAt: string;
  config: RedactedConfig;
};

/** Connections of a scope as the API may return them (secrets redacted). */
export async function listConnectionViews(
  scope: CockpitScope,
): Promise<ConnectionView[]> {
  const rows = await cockpitConnectionRepository.listForScope(
    scope.userId,
    scope.organizationId,
  );
  return rows.map((row) => {
    const provider = row.provider as CockpitProvider;
    const config = isSecretBoxAvailable() ? openConfig(row) : null;
    return {
      id: row.id,
      provider,
      label: row.label,
      enabled: row.enabled,
      lastOkAt: row.lastOkAt?.toISOString() ?? null,
      lastError:
        row.lastError ?? (config ? null : reason("secretsUnavailable")),
      updatedAt: row.updatedAt.toISOString(),
      config: redactConfig(provider, config),
    };
  });
}

/**
 * Where the scope's connections live, and where else the user has some.
 * Connections belong to the active workspace; after switching workspace (or
 * signing in on another domain, which starts a session in the default
 * workspace) they look "gone" while they are intact under the other one.
 */
export type ScopeSummary = {
  /** Active workspace name; null for the personal (organization-less) scope. */
  workspace: string | null;
  /** Other workspaces the user can access that hold connections. */
  elsewhere: Array<{ workspace: string | null; count: number }>;
};

export async function describeScopes(
  scope: CockpitScope,
): Promise<ScopeSummary> {
  const [counts, current] = await Promise.all([
    cockpitConnectionRepository.countScopesForUser(scope.userId),
    scope.organizationId
      ? pgDb
          .select({ name: OrganizationTable.name })
          .from(OrganizationTable)
          .where(eq(OrganizationTable.id, scope.organizationId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    workspace: current[0]?.name ?? null,
    elsewhere: counts
      .filter((c) => c.organizationId !== scope.organizationId && c.count > 0)
      .map((c) => ({ workspace: c.organizationName, count: c.count })),
  };
}

export type SaveResult =
  | { ok: true; connection: ConnectionView }
  | { ok: false; status: 400 | 503; reason: string; issues?: string[] };

/**
 * Validates, (for Revolut) exchanges the one-time authorization code,
 * seals and stores a connection. Blank secret fields keep their stored value.
 */
export async function saveConnection(
  scope: CockpitScope,
  input: {
    provider: CockpitProvider;
    config: Record<string, unknown>;
    label?: string | null;
    enabled?: boolean;
  },
): Promise<SaveResult> {
  if (!isSecretBoxAvailable()) {
    return { ok: false, status: 503, reason: reason("secretsUnavailable") };
  }
  const existing = await cockpitConnectionRepository.findForScope(
    scope.userId,
    scope.organizationId,
    input.provider,
  );
  const stored = existing ? openConfig(existing) : null;
  const merged = mergeSubmittedConfig(input.provider, input.config, stored);

  const prepared = await prepareProvider(input.provider, merged, {
    connectionId: existing?.id,
  });
  if (!prepared.ok) return { ok: false, status: 400, reason: prepared.reason };

  const parsed = parseValidated(input.provider, prepared.config);
  if (!parsed.ok) return parsed;

  try {
    const row = await cockpitConnectionRepository.upsert({
      userId: scope.userId,
      organizationId: scope.organizationId,
      provider: input.provider,
      label: input.label ?? null,
      configEncrypted: seal(parsed.config),
      enabled: input.enabled,
    });
    // Probe once so the CONNECT LED is truthful right after saving; the
    // connection is kept either way (the user may fix the source later).
    const probe = await probeProvider(input.provider, parsed.config, {
      connectionId: row.id,
      version: row.updatedAt.toISOString(),
      scope: ownerScope(row),
    });
    await cockpitConnectionRepository.markResult(
      row.id,
      probe.ok,
      probe.ok ? null : probe.reason,
    );
    const [view] = (await listConnectionViews(scope)).filter(
      (v) => v.id === row.id,
    );
    return { ok: true, connection: view };
  } catch (error) {
    if (error instanceof SecretBoxUnavailableError) {
      return { ok: false, status: 503, reason: reason("secretsUnavailable") };
    }
    throw error;
  }
}

function parseValidated(
  provider: CockpitProvider,
  raw: Record<string, unknown>,
):
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; status: 400; reason: string; issues: string[] } {
  const result = PROVIDERS[provider].configSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, config: result.data as Record<string, unknown> };
  }
  // Field paths only: zod messages could echo a submitted value.
  const issues = [
    ...new Set(result.error.issues.map((i) => String(i.path[0] ?? ""))),
  ].filter(Boolean);
  return { ok: false, status: 400, reason: reason("invalidConfig"), issues };
}

/**
 * Probes either a stored connection (`id`) or a submitted config merged over
 * the stored one, without saving. A stored probe records its outcome.
 */
export async function testConnection(
  scope: CockpitScope,
  input:
    | { id: string }
    | { provider: CockpitProvider; config: Record<string, unknown> },
): Promise<ProbeResult & { status?: number }> {
  if (!isSecretBoxAvailable()) {
    return { ok: false, reason: reason("secretsUnavailable"), status: 503 };
  }
  if ("id" in input) {
    const row = await cockpitConnectionRepository.findByIdForScope(
      input.id,
      scope.userId,
      scope.organizationId,
    );
    if (!row) return { ok: false, reason: reason("notConnected"), status: 404 };
    const config = openConfig(row);
    if (!config) return { ok: false, reason: reason("invalidConfig") };
    const result = await probeProvider(
      row.provider as CockpitProvider,
      config,
      {
        connectionId: row.id,
        version: row.updatedAt.toISOString(),
        scope: ownerScope(row),
      },
    );
    await cockpitConnectionRepository.markResult(
      row.id,
      result.ok,
      result.ok ? null : result.reason,
    );
    return result;
  }

  const existing = await cockpitConnectionRepository.findForScope(
    scope.userId,
    scope.organizationId,
    input.provider,
  );
  const merged = mergeSubmittedConfig(
    input.provider,
    input.config,
    existing ? openConfig(existing) : null,
  );
  // A one-time Revolut code cannot be spent on a test; only save exchanges it.
  delete merged.authorizationCode;
  const parsed = parseValidated(input.provider, merged);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, status: 400 };
  return probeProvider(input.provider, parsed.config, {
    scope: existing ? ownerScope(existing) : scope,
  });
}

export async function removeConnection(
  scope: CockpitScope,
  id: string,
): Promise<boolean> {
  return cockpitConnectionRepository.remove(
    id,
    scope.userId,
    scope.organizationId,
  );
}
