import "server-only";
import { createHash } from "node:crypto";
import logger from "logger";
import { getKernelClient } from "./client";

/**
 * Kernel browser profiles: the cookie jar behind "sign in once, stay signed in".
 *
 * A profile holds the cookies and localStorage a browser accumulated. Load one
 * into a later browser and it starts where the last one left off. That is the
 * only mechanism that reaches sites with no password login at all — an eID
 * portal, a bank with device approval — because a human can complete that check
 * once, by hand, and the saved session carries the result.
 *
 * The sharp edge: Kernel commits profile state only when the browser is DELETED
 * or times out, never on close, and only when the browser was created with
 * `save_changes: true`. Anything that captures a session must therefore reach
 * `destroyBrowserSession`.
 */

/**
 * Profile name for one org's credential.
 *
 * Hashed rather than `${orgId}-${alias}`: names live in a flat namespace
 * Kernel-wide, must be unique within the project, and this keeps a customer's
 * organization id out of a third party's console while staying deterministic,
 * so the name can always be recomputed rather than only ever read back.
 */
export function kernelProfileName(
  organizationId: string,
  alias: string,
): string {
  const digest = createHash("sha256")
    .update(`${organizationId}:${alias}`)
    .digest("hex");
  return `nav-${digest.slice(0, 24)}`;
}

/**
 * Get or create the profile for one credential.
 *
 * Retrieve-then-create rather than create-then-ignore-conflict: Kernel's create
 * is not idempotent on name, and a duplicate would silently split a site's
 * saved session across two jars.
 */
export async function ensureKernelProfile(input: {
  organizationId: string;
  alias: string;
}): Promise<{ id: string | null; name: string }> {
  const name = kernelProfileName(input.organizationId, input.alias);
  const client = getKernelClient();

  try {
    const existing = await client.profiles.retrieve(name);
    return { id: existing.id ?? null, name };
  } catch {
    // Not found is the normal first-connect path, not an error worth logging.
  }

  const created = await client.profiles.create({ name });
  return { id: created.id ?? null, name };
}

/**
 * Delete a profile, e.g. when its credential is removed.
 *
 * Never throws: a stale profile in Kernel is untidy, but failing the delete of
 * the credential row that points at it would be worse — the user would be left
 * with a credential they cannot remove.
 */
export async function deleteKernelProfile(name: string): Promise<void> {
  try {
    await getKernelClient().profiles.delete(name);
  } catch (error) {
    logger.error(
      `[kernel] failed to delete profile ${name}`,
      error instanceof Error ? error.message : error,
    );
  }
}
