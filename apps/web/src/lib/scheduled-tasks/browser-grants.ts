import "server-only";
import { browserCredentialRepository } from "@/lib/db/repository";
import logger from "logger";

/**
 * Narrow a requested set of credential aliases to the ones that actually exist
 * in the caller's organization.
 *
 * The list on a schedule names a capability — "this unattended run may sign in
 * as that account" — so it is validated against the org rather than trusted
 * from the client. Unknown aliases are dropped silently rather than rejected:
 * a credential deleted after a schedule was saved should quietly stop being
 * granted, not make the schedule uneditable.
 *
 * Fails closed. If the lookup itself fails we grant nothing, because the
 * failure mode of guessing the other way is an agent signing in somewhere it
 * was not meant to.
 */
export async function sanitizeCredentialAliases(input: {
  organizationId?: string | null;
  aliases?: string[] | null;
}): Promise<string[] | null> {
  if (!input.aliases) return null;
  if (input.aliases.length === 0) return [];
  if (!input.organizationId) return [];

  try {
    const available =
      await browserCredentialRepository.selectAliasesForOrganization(
        input.organizationId,
      );
    const allowed = new Set(available);
    return [...new Set(input.aliases)].filter((alias) => allowed.has(alias));
  } catch (error) {
    logger.error(
      "[scheduled-tasks] could not validate credential aliases",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}
