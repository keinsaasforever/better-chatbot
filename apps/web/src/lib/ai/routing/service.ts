import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { trace } from "@opentelemetry/api";
import { aiRouteDecisions } from "lib/observability/instruments";
import {
  MemberTable,
  ModelDeploymentTable,
  ModelRouteAuditTable,
  ModelTaskProfileTable,
  ModelsTable,
  OrganizationAiPolicyTable,
  OrganizationModelAccessTable,
} from "@/lib/db/pg/schema.pg";
import type { ChatModel } from "app-types/chat";
import { and, eq, inArray } from "drizzle-orm";
import globalLogger from "logger";
import { selectDeterministicRoute } from "./route";
import {
  type DeterministicRoute,
  type OrganizationRoutingPolicy,
  type RouteSignals,
  type RoutingCandidate,
  RoutingPolicyError,
} from "./types";

type PolicyContext = {
  organizationId?: string;
  memberId?: string;
  automaticRoutingEnabled: boolean;
  browserAutomationEnabled: boolean;
  browserAutomationUnattendedEnabled: boolean;
  policy: OrganizationRoutingPolicy;
};

type CandidateWithAccess = RoutingCandidate & {
  allowedDeploymentIds?: Set<string>;
};

const logger = globalLogger.withDefaults({ message: "Model routing: " });

// Policy context and candidates change only when an admin edits org AI policy
// (rare) or the model catalog is redeployed. Every chat message and every
// page load (models + routing endpoints) was re-running the full query set,
// which saturated the Supabase transaction pooler under concurrent load. A
// short in-memory TTL cache — scoped to one warm serverless instance — lets
// a burst of requests share one DB round trip instead of one each.
const ROUTING_CACHE_TTL_MS = 30_000;

type CacheEntry<T> = { value: T; expiresAt: number };

function readCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function writeCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
): void {
  cache.set(key, { value, expiresAt: Date.now() + ROUTING_CACHE_TTL_MS });
}

const policyContextCache = new Map<string, CacheEntry<PolicyContext>>();
const candidatesCache = new Map<string, CacheEntry<CandidateWithAccess[]>>();

/**
 * Drop cached policy/candidates for an organization so an admin's AI-policy
 * edit (allowlist, price overrides, member caps) takes effect immediately
 * instead of waiting out the TTL. Call after a successful policy write.
 */
export function invalidateRoutingCache(organizationId: string): void {
  candidatesCache.delete(organizationId);
  for (const key of policyContextCache.keys()) {
    if (key.startsWith(`${organizationId}:`)) {
      policyContextCache.delete(key);
    }
  }
}

/**
 * Manual chat must remain available while a newly deployed routing schema is
 * waiting to be migrated. Drizzle wraps the underlying Postgres error, so walk
 * the cause chain instead of depending on one wrapper shape.
 */
/**
 * Why browser automation is unavailable, when it is.
 *
 * An admin who has already switched the policy on needs to be able to tell
 * "your org said no" from "we could not ask" — collapsing both into `false`
 * sent one debugging session chasing a toggle that was already correct.
 */
export type BrowserAutomationGate =
  | { enabled: true }
  | {
      enabled: false;
      reason:
        | "no-organization"
        | "policy-off"
        | "unattended-policy-off"
        | "policy-unavailable";
      detail?: string;
    };

/**
 * Whether this organization has opted into Kernel browser automation, and if
 * not, why.
 *
 * Reads through the same 30s TTL policy cache as routing, so gating the chat
 * tool costs no extra query on the request path. Still fails closed on any
 * routing error — including a schema that predates the column — because the
 * safe default for "drive a real browser" is off; the reason is reported
 * rather than swallowed.
 */
export async function resolveBrowserAutomationGate(input: {
  organizationId?: string | null;
  userId: string;
}): Promise<BrowserAutomationGate> {
  if (!input.organizationId) {
    return { enabled: false, reason: "no-organization" };
  }
  try {
    const context = await getPolicyContext(input);
    return context.browserAutomationEnabled
      ? { enabled: true }
      : { enabled: false, reason: "policy-off" };
  } catch (error) {
    return {
      enabled: false,
      reason: "policy-unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Boolean form of {@link resolveBrowserAutomationGate}. */
export async function isBrowserAutomationEnabled(input: {
  organizationId?: string | null;
  userId: string;
}): Promise<boolean> {
  return (await resolveBrowserAutomationGate(input)).enabled;
}

/**
 * Whether this organization allows browser automation on runs with nobody
 * watching (scheduled agents), and if not, why.
 *
 * Deliberately a second gate rather than a wider reading of the first: an
 * unattended run signs itself in, cannot be rescued when a site misbehaves,
 * and bills browser-seconds while no one is looking at the result. An org that
 * is happy with the watched version has not thereby agreed to that one.
 *
 * Implies the base gate — an org that has not enabled browser automation at
 * all cannot enable it only for robots — so callers check this one alone.
 */
export async function resolveUnattendedBrowserGate(input: {
  organizationId?: string | null;
  userId: string;
}): Promise<BrowserAutomationGate> {
  if (!input.organizationId) {
    return { enabled: false, reason: "no-organization" };
  }
  try {
    const context = await getPolicyContext(input);
    if (!context.browserAutomationEnabled) {
      return { enabled: false, reason: "policy-off" };
    }
    return context.browserAutomationUnattendedEnabled
      ? { enabled: true }
      : { enabled: false, reason: "unattended-policy-off" };
  } catch (error) {
    return {
      enabled: false,
      reason: "policy-unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export function isRoutingSchemaUnavailableError(error: unknown): boolean {
  let current = error;
  const visited = new Set<unknown>();

  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === "42P01" || candidate.code === "42703") {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

async function getPolicyContext(input: {
  organizationId?: string | null;
  userId: string;
}): Promise<PolicyContext> {
  if (!input.organizationId) {
    // No active org fails closed for browser automation, the same way org
    // scoping elsewhere does: an unscoped session gets the safe default.
    return {
      automaticRoutingEnabled: true,
      browserAutomationEnabled: false,
      browserAutomationUnattendedEnabled: false,
      policy: {},
    };
  }

  const cacheKey = `${input.organizationId}:${input.userId}`;
  const cached = readCache(policyContextCache, cacheKey);
  if (cached) return cached;

  const member = await pgDb.query.MemberTable.findFirst({
    where: and(
      eq(MemberTable.organizationId, input.organizationId),
      eq(MemberTable.userId, input.userId),
    ),
  });
  if (!member) {
    throw new RoutingPolicyError(
      "MANUAL_MODEL_NOT_ALLOWED",
      "You are not a member of the active organization.",
    );
  }

  // Read first and only seed when the row is missing. The old unconditional
  // upsert issued a write on every chat message even though the policy row
  // already exists after first use — needless load on the connection pool.
  let policyRow = await pgDb.query.OrganizationAiPolicyTable.findFirst({
    where: eq(OrganizationAiPolicyTable.organizationId, input.organizationId),
  });
  if (!policyRow) {
    await pgDb
      .insert(OrganizationAiPolicyTable)
      .values({ organizationId: input.organizationId })
      .onConflictDoNothing();
    policyRow = await pgDb.query.OrganizationAiPolicyTable.findFirst({
      where: eq(OrganizationAiPolicyTable.organizationId, input.organizationId),
    });
  }

  const context: PolicyContext = {
    organizationId: input.organizationId,
    memberId: member.id,
    automaticRoutingEnabled: policyRow?.automaticRoutingEnabled ?? true,
    browserAutomationEnabled: policyRow?.browserAutomationEnabled ?? false,
    browserAutomationUnattendedEnabled:
      policyRow?.browserAutomationUnattendedEnabled ?? false,
    policy: {
      allowedRegions: policyRow?.allowedRegions,
      maxInputPriceMicrosPerMillion: policyRow?.maxInputPriceMicrosPerMillion,
      maxOutputPriceMicrosPerMillion: policyRow?.maxOutputPriceMicrosPerMillion,
    },
  };
  writeCache(policyContextCache, cacheKey, context);
  return context;
}

async function getCandidates(input: {
  organizationId?: string;
}): Promise<CandidateWithAccess[]> {
  const cacheKey = input.organizationId ?? "__global__";
  const cached = readCache(candidatesCache, cacheKey);
  if (cached) return cached;

  const rows = await pgDb
    .select({
      deployment: ModelDeploymentTable,
      modelName: ModelsTable.model,
    })
    .from(ModelDeploymentTable)
    .innerJoin(ModelsTable, eq(ModelDeploymentTable.modelId, ModelsTable.model))
    .where(eq(ModelDeploymentTable.active, true));

  let allowedDeploymentIds: Set<string> | undefined;
  let accessByDeployment:
    | Map<
        string,
        {
          inputPriceMicrosPerMillionOverride: number | null;
          outputPriceMicrosPerMillionOverride: number | null;
        }
      >
    | undefined;
  if (input.organizationId) {
    let accessRows = await pgDb
      .select({
        deploymentId: OrganizationModelAccessTable.deploymentId,
        enabled: OrganizationModelAccessTable.enabled,
        inputPriceMicrosPerMillionOverride:
          OrganizationModelAccessTable.inputPriceMicrosPerMillionOverride,
        outputPriceMicrosPerMillionOverride:
          OrganizationModelAccessTable.outputPriceMicrosPerMillionOverride,
      })
      .from(OrganizationModelAccessTable)
      .where(
        eq(OrganizationModelAccessTable.organizationId, input.organizationId),
      );

    // New organizations receive an explicit allowlist on first use. Existing
    // organizations are seeded by the migration. A non-empty access table is
    // never widened here, so an admin's choices remain authoritative.
    if (accessRows.length === 0 && rows.length > 0) {
      await pgDb
        .insert(OrganizationModelAccessTable)
        .values(
          rows.map(({ deployment }) => ({
            organizationId: input.organizationId!,
            deploymentId: deployment.id,
            enabled: true,
          })),
        )
        .onConflictDoNothing();
      accessRows = await pgDb
        .select({
          deploymentId: OrganizationModelAccessTable.deploymentId,
          enabled: OrganizationModelAccessTable.enabled,
          inputPriceMicrosPerMillionOverride:
            OrganizationModelAccessTable.inputPriceMicrosPerMillionOverride,
          outputPriceMicrosPerMillionOverride:
            OrganizationModelAccessTable.outputPriceMicrosPerMillionOverride,
        })
        .from(OrganizationModelAccessTable)
        .where(
          eq(OrganizationModelAccessTable.organizationId, input.organizationId),
        );
    }
    allowedDeploymentIds = new Set(
      accessRows.filter((row) => row.enabled).map((row) => row.deploymentId),
    );
    accessByDeployment = new Map(
      accessRows.map((row) => [
        row.deploymentId,
        {
          inputPriceMicrosPerMillionOverride:
            row.inputPriceMicrosPerMillionOverride,
          outputPriceMicrosPerMillionOverride:
            row.outputPriceMicrosPerMillionOverride,
        },
      ]),
    );
  }

  const modelIds = [...new Set(rows.map(({ modelName }) => modelName))];
  const profiles =
    modelIds.length === 0
      ? []
      : await pgDb
          .select()
          .from(ModelTaskProfileTable)
          .where(inArray(ModelTaskProfileTable.modelId, modelIds));

  const profilesByModel = new Map<string, typeof profiles>();
  for (const profile of profiles) {
    const existing = profilesByModel.get(profile.modelId) ?? [];
    existing.push(profile);
    profilesByModel.set(profile.modelId, existing);
  }

  const candidates = rows.map(({ deployment, modelName }) => {
    const access = accessByDeployment?.get(deployment.id);
    return {
      deploymentId: deployment.id,
      modelId: modelName,
      chatModel: {
        provider: deployment.provider,
        model: deployment.providerModelId,
      },
      providerModelId: deployment.providerModelId,
      region: deployment.region,
      dataRetention:
        deployment.dataRetention as RoutingCandidate["dataRetention"],
      inputPriceMicrosPerMillion:
        access?.inputPriceMicrosPerMillionOverride ??
        deployment.inputPriceMicrosPerMillion,
      outputPriceMicrosPerMillion:
        access?.outputPriceMicrosPerMillionOverride ??
        deployment.outputPriceMicrosPerMillion,
      contextTokens: deployment.contextTokens,
      supportsTools: deployment.supportsTools,
      supportsVision: deployment.supportsVision,
      active: deployment.active,
      profiles: (profilesByModel.get(modelName) ?? []).map((profile) => ({
        taskKey:
          profile.taskKey as RoutingCandidate["profiles"][number]["taskKey"],
        score: profile.score,
        tieBreakPriority: profile.tieBreakPriority,
        bestTaskDescription: profile.bestTaskDescription,
      })),
      ...(allowedDeploymentIds ? { allowedDeploymentIds } : {}),
    };
  });
  writeCache(candidatesCache, cacheKey, candidates);
  return candidates;
}

function withAccessPolicy(
  policy: OrganizationRoutingPolicy,
  candidates: CandidateWithAccess[],
): OrganizationRoutingPolicy {
  return {
    ...policy,
    allowedDeploymentIds: candidates[0]?.allowedDeploymentIds,
  };
}

/**
 * Routes one turn of automatic ("Auto") model selection.
 *
 * `previousChatModel` keeps a thread on the model it started on: pass the
 * model the thread's last turn ran on and routing re-uses it whenever it is
 * still eligible, instead of re-deciding from signals that shift with every
 * message. Omitting it restores the per-message behaviour, which discards the
 * thread's prompt cache on every change of mind.
 */
export async function resolveAutomaticRoute(input: {
  organizationId?: string | null;
  userId: string;
  signals: RouteSignals;
  previousChatModel?: ChatModel | null;
}): Promise<
  DeterministicRoute & { memberId?: string; organizationId?: string }
> {
  const context = await getPolicyContext(input);
  if (!context.automaticRoutingEnabled) {
    throw new RoutingPolicyError(
      "AUTOMATIC_ROUTING_DISABLED",
      "Automatic routing is disabled by your organization administrator.",
    );
  }
  const candidates = await getCandidates({
    organizationId: context.organizationId,
  });
  const route = selectDeterministicRoute({
    candidates,
    signals: input.signals,
    policy: withAccessPolicy(context.policy, candidates),
    pinnedChatModel: input.previousChatModel,
  });

  // `reasonCode` and `taskKey` are the two things you need to explain "why did
  // this org get that model?" when a downstream gateway call starts failing.
  // Both are enum-like, so they are safe as metric dimensions; the org id is
  // not, and stays on the span.
  aiRouteDecisions.add(1, {
    taskKey: route.taskKey,
    reasonCode: route.reasonCode,
    source: "automatic",
  });
  const activeSpan = trace.getActiveSpan();
  activeSpan?.setAttributes({
    "ai.route.task_key": route.taskKey,
    "ai.route.reason_code": route.reasonCode,
    "ai.route.deployment_id": route.candidate.deploymentId,
    ...(context.organizationId
      ? { "app.organization.id": context.organizationId }
      : {}),
  });

  // Audit trail only — must not hold up the response or the model call while
  // waiting on a pooled connection. Fire-and-forget with logging instead of
  // awaiting; a dropped audit row is far cheaper than a stalled chat.
  pgDb
    .insert(ModelRouteAuditTable)
    .values({
      organizationId: context.organizationId,
      memberId: context.memberId,
      deploymentId: route.candidate.deploymentId,
      taskKey: route.taskKey,
      taskScore: route.taskScore,
      reasonCode: route.reasonCode,
    })
    .catch((error) => {
      logger.error("Failed to write model route audit row", error);
    });

  return { ...route, ...context };
}

export async function validateManualModel(input: {
  organizationId?: string | null;
  userId: string;
  chatModel: ChatModel;
}): Promise<{
  chatModel: ChatModel;
  candidate?: RoutingCandidate;
  memberId?: string;
}> {
  if (!input.organizationId) {
    return { chatModel: input.chatModel };
  }
  // Local models are resolved from per-user preferences (see getModelInstance),
  // never from model_deployment, so they are not routing candidates. Skip the
  // org-policy check instead of failing them closed as "not allowed".
  if (input.chatModel.provider === "Local Models") {
    return { chatModel: input.chatModel };
  }
  let context: PolicyContext;
  let candidates: CandidateWithAccess[];
  try {
    context = await getPolicyContext(input);
    candidates = await getCandidates({
      organizationId: context.organizationId,
    });
  } catch (error) {
    if (isRoutingSchemaUnavailableError(error)) {
      return { chatModel: input.chatModel };
    }
    throw error;
  }
  const policy = withAccessPolicy(context.policy, candidates);
  const match = candidates.find(
    (candidate) =>
      candidate.chatModel.provider === input.chatModel.provider &&
      candidate.chatModel.model === input.chatModel.model,
  );
  if (
    !match ||
    match.inputPriceMicrosPerMillion <= 0 ||
    match.outputPriceMicrosPerMillion <= 0 ||
    match.dataRetention === "unknown" ||
    (policy.allowedDeploymentIds &&
      !policy.allowedDeploymentIds.has(match.deploymentId))
  ) {
    throw new RoutingPolicyError(
      "MANUAL_MODEL_NOT_ALLOWED",
      "That model is not available in your organization.",
    );
  }
  return {
    chatModel: match.chatModel,
    candidate: match,
    memberId: context.memberId,
  };
}

export async function getAvailableOrganizationModels(input: {
  organizationId?: string | null;
  userId: string;
}): Promise<{ automaticRoutingEnabled: boolean; models: ChatModel[] }> {
  const context = await getPolicyContext(input);
  const candidates = await getCandidates({
    organizationId: context.organizationId,
  });
  const policy = withAccessPolicy(context.policy, candidates);
  return {
    automaticRoutingEnabled: context.automaticRoutingEnabled,
    models: candidates
      .filter(
        (candidate) =>
          candidate.inputPriceMicrosPerMillion > 0 &&
          candidate.outputPriceMicrosPerMillion > 0 &&
          candidate.dataRetention !== "unknown" &&
          (!policy.allowedDeploymentIds ||
            policy.allowedDeploymentIds.has(candidate.deploymentId)),
      )
      .map((candidate) => candidate.chatModel),
  };
}
