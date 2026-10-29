import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import logger from "logger";
import {
  claimScheduledSlot,
  findDueScheduledTasks,
} from "@/lib/scheduled-tasks/checker";
import {
  executeAgentRun,
  loadScheduledTaskContext,
  recordScheduledRunResult,
  type ScheduledRunResult,
} from "@/lib/scheduled-tasks/runner";

// Loopback chat runs can take a while; give the batch room like /api/inngest.
export const maxDuration = 300;

/**
 * POST /api/scheduled-tasks/cron
 *
 * A secret-gated fallback for the Inngest cron checker. Runs the SAME
 * due-detection + slot-claim logic, so the scheduled path can be driven by any
 * external scheduler (Vercel Cron, Supabase pg_cron + pg_net) and — crucially —
 * proven end-to-end WITHOUT an Inngest Cloud registration.
 *
 * Authorization is checked here (constant-time) rather than relying on the
 * middleware bypass: the middleware only forwards the request, this route
 * decides. Caller must send `X-Scheduled-Task-Auth: $SCHEDULED_TASK_SECRET`.
 *
 * Safe to run concurrently with the Inngest checker: `claimScheduledSlot` is an
 * atomic conditional UPDATE, so a slot claimed by one transport is refused by
 * the other.
 */
export async function POST(request: Request) {
  const secret = process.env.SCHEDULED_TASK_SECRET;
  if (!secret) {
    logger.error(
      "[scheduled-tasks] cron route hit but SCHEDULED_TASK_SECRET unset",
    );
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  const provided = request.headers.get("X-Scheduled-Task-Auth") ?? "";
  if (!constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const due = await findDueScheduledTasks(now);

  let ran = 0;
  let skipped = 0;
  let failed = 0;

  // Sequential on purpose: bounds concurrent loopback chat streams against the
  // web tier (the Inngest path caps this too) and keeps DB-pool pressure low.
  for (const { taskId, slot } of due) {
    const ctx = await loadScheduledTaskContext(taskId);
    if (!ctx.ok || !ctx.task.enabled) {
      skipped++;
      continue;
    }

    const won = await claimScheduledSlot(taskId, slot, now);
    if (!won) {
      skipped++;
      continue;
    }

    let result: ScheduledRunResult;
    try {
      result = await executeAgentRun(ctx.task, ctx.agent);
    } catch (error) {
      result = {
        success: false,
        error: error instanceof Error ? error.message : "Chat request failed",
        threadId: null,
      };
    }
    await recordScheduledRunResult(taskId, ctx.task, ctx.agent, result);
    if (result.success) ran++;
    else failed++;
  }

  logger.info("[scheduled-tasks] fallback cron tick", {
    due: due.length,
    ran,
    skipped,
    failed,
  });
  return NextResponse.json({ due: due.length, ran, skipped, failed });
}

// Length-independent constant-time compare. Hash-free: compares fixed-size
// buffers so a length mismatch can't short-circuit and leak length via timing.
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Compare against self to keep the timing path uniform, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
