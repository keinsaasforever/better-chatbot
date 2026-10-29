import type { AgentFileBinding } from "app-types/agent";
import { isUserOwnedStorageKey } from "lib/code-runner/storage-key";

/**
 * Guard the file bindings a client sends with an agent write.
 *
 * A binding is a read grant: whatever key it names is later downloaded with the
 * service-role storage client and written into a sandbox. So a caller may only
 * bind keys under its own storage prefix. Keys already stored on the agent are
 * exempt, otherwise an org member editing a shared agent would have to own the
 * creator's template just to rename the agent.
 */
export function assertOwnedAgentFiles(input: {
  files: AgentFileBinding[] | undefined;
  userId: string;
  existingFiles?: AgentFileBinding[];
}): { ok: true } | { ok: false; storageKey: string } {
  if (!input.files?.length) return { ok: true };

  const carriedOver = new Set(
    (input.existingFiles ?? []).map((file) => file.storageKey),
  );

  for (const file of input.files) {
    if (carriedOver.has(file.storageKey)) continue;
    if (!isUserOwnedStorageKey(file.storageKey, input.userId)) {
      return { ok: false, storageKey: file.storageKey };
    }
  }

  return { ok: true };
}
