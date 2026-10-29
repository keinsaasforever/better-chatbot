import { timingSafeEqual } from "node:crypto";
import { reapSandboxes } from "lib/e2b/reap-sandboxes";
import logger from "logger";
import { NextResponse } from "next/server";

export const maxDuration = 300;

/**
 * POST /api/sandbox/reaper
 *
 * Secret-gated fallback for the Inngest reaper cron, running the SAME sweep so
 * it can be driven by any external scheduler (Supabase pg_cron + pg_net,
 * Vercel Cron) and proven end-to-end without an Inngest Cloud registration.
 *
 * Reuses `SCHEDULED_TASK_SECRET` and the `X-Scheduled-Task-Auth` header rather
 * than minting a second credential — middleware already forwards requests
 * carrying it, and this route makes the actual decision, constant-time.
 *
 * Safe to run concurrently with the Inngest function: pausing an
 * already-paused sandbox is a no-op, so the worst case for a double run is a
 * few redundant API calls.
 */
export async function POST(request: Request) {
  const secret = process.env.SCHEDULED_TASK_SECRET;
  if (!secret) {
    logger.error("[e2b] reaper route hit but SCHEDULED_TASK_SECRET unset");
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const provided = request.headers.get("X-Scheduled-Task-Auth") ?? "";
  if (!constantTimeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.E2B_API_KEY) {
    return NextResponse.json(
      { error: "E2B_API_KEY is not configured" },
      { status: 503 },
    );
  }

  const result = await reapSandboxes();
  logger.info("[e2b] reaper tick (http)", result);
  return NextResponse.json(result);
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
