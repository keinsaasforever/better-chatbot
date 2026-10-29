import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import {
  MemberAiPolicyTable,
  MemberAiReservationTable,
  MemberAiUsagePeriodTable,
} from "@/lib/db/pg/schema.pg";
import { and, eq, sql } from "drizzle-orm";
import {
  resolveCacheRatios,
  weightInputTokens,
} from "@/lib/ai/cache-weighted-tokens";
import type { RoutingCandidate } from "./types";

const MICROS_PER_MILLION = 1_000_000;
const RESERVATION_TTL_MS = 15 * 60 * 1000;

export class MemberBudgetExceededError extends Error {
  constructor() {
    super("Your monthly AI allowance has been reached.");
    this.name = "MemberBudgetExceededError";
  }
}

/**
 * The €15 member caps run on a second, parallel cost model. It has to weigh
 * cached input the same way `trackCostBasedTokens` does, or a capped member is
 * charged against their allowance at a rate the invoice never sees - stricter
 * than the billing they can actually check.
 *
 * `cacheReadTokens` / `cacheWriteTokens` are optional: the reservation made
 * before a run has no usage to read, so it estimates on gross tokens as
 * before, and only the finalisation after the run passes the breakdown.
 */
export function estimateCostMicros(input: {
  inputTokens: number;
  outputTokens: number;
  candidate: RoutingCandidate;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  noCacheTokens?: number;
}): number {
  const { effectiveInputTokens } = weightInputTokens(
    {
      promptTokens: input.inputTokens,
      cacheReadTokens: input.cacheReadTokens,
      cacheWriteTokens: input.cacheWriteTokens,
      noCacheTokens: input.noCacheTokens,
    },
    resolveCacheRatios(),
  );

  const inputCost =
    (effectiveInputTokens * input.candidate.inputPriceMicrosPerMillion) /
    MICROS_PER_MILLION;
  const outputCost =
    (input.outputTokens * input.candidate.outputPriceMicrosPerMillion) /
    MICROS_PER_MILLION;
  return Math.ceil(inputCost + outputCost);
}

export function getCurrentPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  return { start, end };
}

export async function reserveMemberBudget(input: {
  memberId?: string;
  deploymentId: string;
  estimateMicros: number;
  idempotencyKey: string;
}) {
  if (!input.memberId) return undefined;

  // Fast path: the overwhelming majority of members have no hard budget cap.
  // Read the policy with a single auto-committed query — no transaction, no
  // advisory lock — so the common case never checks out a pooled connection to
  // hold across a serialized critical section. Only capped members below pay
  // for the transaction + lock. This keeps the model router off the hot path
  // that was exhausting Supabase's transaction pooler.
  const policyPreview = await pgDb.query.MemberAiPolicyTable.findFirst({
    where: eq(MemberAiPolicyTable.memberId, input.memberId),
  });
  if (!policyPreview?.hardStop || policyPreview.monthlyCapMicros == null) {
    return undefined;
  }

  return pgDb.transaction(async (tx) => {
    // Serialize only one member's balance updates. This avoids two concurrent
    // requests both observing room below the same cap.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.memberId}))`,
    );

    // Re-read inside the lock: the cap could have been added, removed, or
    // changed between the lock-free preview above and acquiring the lock.
    const policy = await tx.query.MemberAiPolicyTable.findFirst({
      where: eq(MemberAiPolicyTable.memberId, input.memberId!),
    });
    if (!policy?.hardStop || policy.monthlyCapMicros == null) return undefined;

    const { start, end } = getCurrentPeriod();
    await tx
      .insert(MemberAiUsagePeriodTable)
      .values({
        memberId: input.memberId!,
        periodStart: start,
        periodEnd: end,
      })
      .onConflictDoNothing();

    const period = await tx.query.MemberAiUsagePeriodTable.findFirst({
      where: and(
        eq(MemberAiUsagePeriodTable.memberId, input.memberId!),
        eq(MemberAiUsagePeriodTable.periodStart, start),
      ),
    });
    if (!period) throw new Error("Unable to create member AI usage period.");

    const existing = await tx.query.MemberAiReservationTable.findFirst({
      where: eq(MemberAiReservationTable.idempotencyKey, input.idempotencyKey),
    });
    if (existing) return existing;

    if (
      period.finalizedMicros + period.reservedMicros + input.estimateMicros >
      policy.monthlyCapMicros
    ) {
      throw new MemberBudgetExceededError();
    }

    await tx
      .update(MemberAiUsagePeriodTable)
      .set({ reservedMicros: period.reservedMicros + input.estimateMicros })
      .where(eq(MemberAiUsagePeriodTable.id, period.id));

    const [reservation] = await tx
      .insert(MemberAiReservationTable)
      .values({
        usagePeriodId: period.id,
        deploymentId: input.deploymentId,
        idempotencyKey: input.idempotencyKey,
        estimateMicros: input.estimateMicros,
        expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
      })
      .returning();
    return reservation;
  });
}

export async function finalizeMemberBudget(input: {
  reservationId?: string;
  actualMicros: number;
}) {
  if (!input.reservationId) return;

  await pgDb.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${input.reservationId}))`,
    );
    const reservation = await tx.query.MemberAiReservationTable.findFirst({
      where: eq(MemberAiReservationTable.id, input.reservationId!),
    });
    if (!reservation || reservation.status !== "reserved") return;

    const period = await tx.query.MemberAiUsagePeriodTable.findFirst({
      where: eq(MemberAiUsagePeriodTable.id, reservation.usagePeriodId),
    });
    if (!period) throw new Error("Member AI usage period is missing.");

    await tx
      .update(MemberAiUsagePeriodTable)
      .set({
        reservedMicros: Math.max(
          0,
          period.reservedMicros - reservation.estimateMicros,
        ),
        finalizedMicros:
          period.finalizedMicros + Math.max(0, input.actualMicros),
      })
      .where(eq(MemberAiUsagePeriodTable.id, period.id));
    await tx
      .update(MemberAiReservationTable)
      .set({
        actualMicros: Math.max(0, input.actualMicros),
        status: "finalized",
        finalizedAt: new Date(),
      })
      .where(eq(MemberAiReservationTable.id, reservation.id));
  });
}

export async function releaseMemberBudget(reservationId?: string) {
  if (!reservationId) return;

  await pgDb.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${reservationId}))`,
    );
    const reservation = await tx.query.MemberAiReservationTable.findFirst({
      where: eq(MemberAiReservationTable.id, reservationId!),
    });
    if (!reservation || reservation.status !== "reserved") return;

    const period = await tx.query.MemberAiUsagePeriodTable.findFirst({
      where: eq(MemberAiUsagePeriodTable.id, reservation.usagePeriodId),
    });
    if (!period) return;

    await tx
      .update(MemberAiUsagePeriodTable)
      .set({
        reservedMicros: Math.max(
          0,
          period.reservedMicros - reservation.estimateMicros,
        ),
      })
      .where(eq(MemberAiUsagePeriodTable.id, period.id));
    await tx
      .update(MemberAiReservationTable)
      .set({ status: "released", finalizedAt: new Date() })
      .where(eq(MemberAiReservationTable.id, reservation.id));
  });
}
