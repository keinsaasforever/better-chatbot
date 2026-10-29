import { and, asc, eq, inArray } from "drizzle-orm";
import { pgDb as db } from "../db.pg";
import {
  type BrowserCredentialEntity,
  BrowserCredentialTable,
} from "../schema.pg";

/**
 * A credential as anything outside `lib/kernel` is allowed to see it.
 *
 * `externalSecretId` is absent by construction, not filtered later: the select
 * list never asks for it. A handler that forgets to strip a field cannot leak
 * a pointer it was never handed.
 */
export type BrowserCredentialSummary = {
  id: string;
  alias: string;
  label: string | null;
  domain: string;
  allowedUrlPrefix: string | null;
  usernameHint: string | null;
  hasSecret: boolean;
  hasProfile: boolean;
  profileSavedAt: Date | null;
  lastUsedAt: Date | null;
};

/** The internal view, with the secret pointer. Only the vault reads this. */
export type BrowserCredentialSecretRef = {
  id: string;
  alias: string;
  domain: string;
  allowedUrlPrefix: string | null;
  externalSecretId: string | null;
  kernelProfileId: string | null;
  kernelProfileName: string | null;
};

const SUMMARY_COLUMNS = {
  id: BrowserCredentialTable.id,
  alias: BrowserCredentialTable.alias,
  label: BrowserCredentialTable.label,
  domain: BrowserCredentialTable.domain,
  allowedUrlPrefix: BrowserCredentialTable.allowedUrlPrefix,
  usernameHint: BrowserCredentialTable.usernameHint,
  externalSecretId: BrowserCredentialTable.externalSecretId,
  kernelProfileName: BrowserCredentialTable.kernelProfileName,
  profileSavedAt: BrowserCredentialTable.profileSavedAt,
  lastUsedAt: BrowserCredentialTable.lastUsedAt,
} as const;

export const pgBrowserCredentialRepository = {
  /**
   * Every credential in one organization, without secret pointers.
   *
   * `externalSecretId` is selected only to compute `hasSecret` and is dropped
   * in the same expression, so it never escapes this function.
   */
  async selectAllForOrganization(
    organizationId: string,
  ): Promise<BrowserCredentialSummary[]> {
    const rows = await db
      .select(SUMMARY_COLUMNS)
      .from(BrowserCredentialTable)
      .where(eq(BrowserCredentialTable.organizationId, organizationId))
      .orderBy(asc(BrowserCredentialTable.alias));

    return rows.map(({ externalSecretId, kernelProfileName, ...rest }) => ({
      ...rest,
      hasSecret: Boolean(externalSecretId),
      hasProfile: Boolean(kernelProfileName),
    }));
  },

  /**
   * The aliases that exist in this org, for validating a caller's pin list.
   */
  async selectAliasesForOrganization(
    organizationId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ alias: BrowserCredentialTable.alias })
      .from(BrowserCredentialTable)
      .where(eq(BrowserCredentialTable.organizationId, organizationId));
    return rows.map((row) => row.alias);
  },

  /**
   * Secret pointers for a pinned set of aliases.
   *
   * The one method that returns `externalSecretId`. Imported only by
   * `lib/kernel/credential-vault`; keep it that way.
   */
  async selectSecretRefsByAliases(
    organizationId: string,
    aliases: string[],
  ): Promise<BrowserCredentialSecretRef[]> {
    if (aliases.length === 0) return [];
    return db
      .select({
        id: BrowserCredentialTable.id,
        alias: BrowserCredentialTable.alias,
        domain: BrowserCredentialTable.domain,
        allowedUrlPrefix: BrowserCredentialTable.allowedUrlPrefix,
        externalSecretId: BrowserCredentialTable.externalSecretId,
        kernelProfileId: BrowserCredentialTable.kernelProfileId,
        kernelProfileName: BrowserCredentialTable.kernelProfileName,
      })
      .from(BrowserCredentialTable)
      .where(
        and(
          eq(BrowserCredentialTable.organizationId, organizationId),
          inArray(BrowserCredentialTable.alias, aliases),
        ),
      );
  },

  /** Create or replace one credential, keyed on (organization, alias). */
  async upsertCredential(input: {
    organizationId: string;
    createdByUserId: string;
    alias: string;
    label?: string | null;
    domain: string;
    allowedUrlPrefix?: string | null;
    usernameHint?: string | null;
    externalSecretId?: string | null;
  }): Promise<BrowserCredentialEntity> {
    const [row] = await db
      .insert(BrowserCredentialTable)
      .values({
        organizationId: input.organizationId,
        createdByUserId: input.createdByUserId,
        alias: input.alias,
        label: input.label ?? null,
        domain: input.domain,
        allowedUrlPrefix: input.allowedUrlPrefix ?? null,
        usernameHint: input.usernameHint ?? null,
        externalSecretId: input.externalSecretId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          BrowserCredentialTable.organizationId,
          BrowserCredentialTable.alias,
        ],
        set: {
          label: input.label ?? null,
          domain: input.domain,
          allowedUrlPrefix: input.allowedUrlPrefix ?? null,
          usernameHint: input.usernameHint ?? null,
          externalSecretId: input.externalSecretId ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return row;
  },

  /**
   * Delete one credential. Returns the deleted row so the caller can clean up
   * the Scaleway secret and the Kernel profile it pointed at.
   */
  async deleteByAlias(
    organizationId: string,
    alias: string,
  ): Promise<BrowserCredentialEntity | null> {
    const [row] = await db
      .delete(BrowserCredentialTable)
      .where(
        and(
          eq(BrowserCredentialTable.organizationId, organizationId),
          eq(BrowserCredentialTable.alias, alias),
        ),
      )
      .returning();
    return row ?? null;
  },

  /** Record the Kernel profile a connect-site run captured. */
  async updateKernelProfile(
    organizationId: string,
    alias: string,
    profile: { profileId: string | null; profileName: string; savedAt?: Date },
  ): Promise<void> {
    await db
      .update(BrowserCredentialTable)
      .set({
        kernelProfileId: profile.profileId,
        kernelProfileName: profile.profileName,
        ...(profile.savedAt ? { profileSavedAt: profile.savedAt } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(BrowserCredentialTable.organizationId, organizationId),
          eq(BrowserCredentialTable.alias, alias),
        ),
      );
  },

  async touchLastUsed(
    organizationId: string,
    aliases: string[],
  ): Promise<void> {
    if (aliases.length === 0) return;
    await db
      .update(BrowserCredentialTable)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(BrowserCredentialTable.organizationId, organizationId),
          inArray(BrowserCredentialTable.alias, aliases),
        ),
      );
  },
};
