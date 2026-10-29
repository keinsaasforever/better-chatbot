import { resolveBillingCustomerById } from "lib/billing/billing-customer";
import type { AuthenticatedVoiceDevice } from "lib/voice/device-auth";

/**
 * Which Autumn customer a voice session bills to.
 *
 * Delegates to the shared resolver so voice cannot drift from chat again: this
 * used to test only the legacy `personal-` id prefix, which meant a modern
 * personal workspace billed voice to its organization while chat billed the
 * same person to their user id.
 *
 * Async because the callers are device-authenticated and hold an organization
 * id but no metadata.
 */
export function resolveVoiceBillingCustomerId(input: {
  userId: string;
  organizationId?: string | null;
}): Promise<string> {
  return resolveBillingCustomerById(input).then(({ customerId }) => customerId);
}

export function resolveVoiceActorBillingCustomerId(
  actor: AuthenticatedVoiceDevice,
): Promise<string> {
  return resolveVoiceBillingCustomerId({
    userId: actor.userId,
    organizationId: actor.organizationId,
  });
}
