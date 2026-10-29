import "server-only";
import { eq } from "drizzle-orm";
import { roleHasPermission } from "lib/auth/permissions";
import { resolveBillingCustomerById } from "lib/billing/billing-customer";
import { pgDb } from "lib/db/pg/db.pg";
import { UserTable } from "lib/db/pg/schema.pg";
import { agentRepository } from "lib/db/repository";
import {
  CreditsExhaustedError,
  assertCreditsAvailable,
  trackUsage,
} from "lib/gate";
import { generateUUID } from "lib/utils";
import { matchAgentByReference } from "lib/voice/match-agent";
import type { VoiceActor } from "lib/voice/types";
import globalLogger from "logger";
import { NavigatorToolError, type ToolActor } from "./types";

const logger = globalLogger.withDefaults({ message: "Navigator Tools: " });

export const NO_ORG_MESSAGE =
  "Es ist keine Organisation aktiv. Bitte in der App eine Organisation auswählen.";

export function trim(
  value: string | null | undefined,
  max: number,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/** The active organization, or a spoken-ready refusal when there is none. */
export function requireOrganization(actor: ToolActor): string {
  if (!actor.organizationId) {
    throw new NavigatorToolError("organization_required", NO_ORG_MESSAGE);
  }
  return actor.organizationId;
}

/**
 * The actor as the voice helpers expect it. Those helpers predate the registry
 * and only read `userId` and `organizationId`; `source` is the browser value
 * because every caller here is a first-party surface, never a device.
 */
export function toVoiceActor(actor: ToolActor): VoiceActor {
  return {
    userId: actor.userId,
    organizationId: actor.organizationId,
    source: "browser",
  };
}

/**
 * Enforce the app role (admin / editor / user) for a mutation.
 *
 * The routes read the role from the session cookie; tool callers may hold an
 * API key instead, so the role is read from the user row. A missing user fails
 * closed.
 */
export async function assertRolePermission(
  actor: ToolActor,
  permission: Parameters<typeof roleHasPermission>[1],
  resource: Parameters<typeof roleHasPermission>[2],
  message: string,
): Promise<void> {
  const [row] = await pgDb
    .select({ role: UserTable.role })
    .from(UserTable)
    .where(eq(UserTable.id, actor.userId))
    .limit(1);
  if (!row || !roleHasPermission(row.role, permission, resource)) {
    throw new NavigatorToolError("forbidden", message);
  }
}

/**
 * Find an agent from whatever the caller said.
 *
 * A speech model asked to "use the sales agent" says "sales agent", not a
 * UUID, and even with the roster in its instructions it paraphrases. So both
 * are accepted: an exact id first, then a case-insensitive name match, then a
 * contains match. The candidate list on a miss lets the caller say which
 * agents DO exist instead of a bare "not found".
 */
export async function resolveAgentReference(
  actor: ToolActor,
  reference: string,
): Promise<
  { ok: true; id: string; name: string } | { ok: false; available: string[] }
> {
  const agents = await agentRepository
    .selectAgents(actor.userId, ["all"], 50, actor.organizationId ?? undefined)
    .catch(() => []);
  const match = matchAgentByReference(agents, reference);

  return match
    ? { ok: true, id: match.id, name: match.name }
    : { ok: false, available: agents.map((agent) => agent.name) };
}

/** `resolveAgentReference`, throwing the spoken-ready "not found" on a miss. */
export async function requireAgentReference(
  actor: ToolActor,
  reference: string,
): Promise<{ id: string; name: string }> {
  const resolved = await resolveAgentReference(actor, reference);
  if (!resolved.ok) {
    throw new NavigatorToolError(
      "not_found",
      resolved.available.length
        ? `No agent matches "${reference}". Available: ${resolved.available.slice(0, 20).join(", ")}.`
        : "This workspace has no agents yet.",
    );
  }
  return { id: resolved.id, name: resolved.name };
}

export type ActorBilling = { customerId: string; entityId?: string };

/**
 * The credit gate every model-invoking tool passes before it calls a model.
 *
 * Tool callers have no session to read billing from, so the customer is
 * resolved from the actor's organization the way device-authenticated routes
 * do. `assertCreditsAvailable` fails closed only on an explicit "no credits"
 * from the billing provider; anything else fails open, as in chat.
 */
export async function assertActorCredits(
  actor: ToolActor,
): Promise<ActorBilling> {
  const billing = await resolveBillingCustomerById({
    userId: actor.userId,
    organizationId: actor.organizationId,
  }).catch(() => ({ customerId: actor.userId }) as ActorBilling);

  try {
    await assertCreditsAvailable({
      customerId: billing.customerId,
      entityId: billing.entityId,
    });
  } catch (error) {
    if (error instanceof CreditsExhaustedError) {
      throw new NavigatorToolError(
        "credits_exhausted",
        "This workspace has no AI credits left. Top up in the app to continue.",
      );
    }
    throw error;
  }
  return billing;
}

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    noCacheTokens?: number;
  };
};

/**
 * Report the tokens a tool's model call spent. Best effort: a billing hiccup
 * is logged, never surfaced, so the user still gets the answer they paid for.
 * The idempotency key is the model response id, so a retried report of the
 * same response is deduplicated by the billing provider.
 */
export async function trackActorTokens(
  actor: ToolActor,
  billing: ActorBilling,
  input: {
    operation: string;
    modelId: string;
    usage: TokenUsage | undefined;
    responseId?: string;
  },
): Promise<void> {
  const usage = input.usage;
  if (!usage?.inputTokens && !usage?.outputTokens) return;
  try {
    await trackUsage({
      kind: "tokens",
      customerId: billing.customerId,
      entityId: billing.entityId,
      modelId: input.modelId,
      promptTokens: usage.inputTokens ?? 0,
      completionTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
      cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
      noCacheTokens: usage.inputTokenDetails?.noCacheTokens,
      idempotencyKey: `navigator-tool-${input.operation}-${input.responseId ?? generateUUID()}`,
      properties: {
        operation: input.operation,
        source: actor.source,
        userId: actor.userId,
      },
    });
  } catch (error) {
    logger.error(`Usage tracking failed for ${input.operation}:`, error);
  }
}
