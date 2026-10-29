import { Sandbox } from "@e2b/code-interpreter";
import { getSession } from "auth/server";
import {
  PREVIEW_IDLE_TIMEOUT_MS,
  errorLabel,
  toSandboxErrorResponse,
} from "lib/e2b/create-sandbox";
import { pgSandboxSessionRepository } from "lib/db/pg/repositories/sandbox-session-repository.pg";
import { isSandboxOwner } from "lib/e2b/sandbox-ownership";
import logger from "lib/logger";
import { NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * Extend a running preview sandbox's TTL. Called as a heartbeat from the
 * artifact panel while a preview is open and the user is actually looking at
 * it, so the iframe doesn't die mid-session.
 *
 * The heartbeat is deliberately *not* unconditional — see
 * `hooks/use-sandbox-keepalive.ts`. This route is the last thing standing
 * between an idle tab and an unbounded bill, so it renews to the short idle
 * TTL rather than a generous one: `setTimeout` resets the deadline absolutely
 * and can shorten it, unlike `connect`, which only ever ratchets it upward.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ sbxId: string }> },
) {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.E2B_API_KEY) {
    return NextResponse.json(
      { error: "E2B_API_KEY is not configured" },
      { status: 500 },
    );
  }

  const { sbxId } = await params;

  // Without this check any authenticated user could keep any sandbox in the
  // account alive by ID — an authorization hole whose direct consequence is
  // compute billed to someone else.
  //
  // `touch` authorizes and records liveness in a single ownership-scoped
  // UPDATE, so the heartbeat costs one indexed write rather than a read plus
  // an update. `lastActiveAt` is what lets the reaper tell "the user walked
  // away" from "the browser never got to send a pause".
  const touched = await pgSandboxSessionRepository
    .touch(sbxId, session.user.id)
    .catch(() => false);

  // Sandboxes created before the registry existed have no row; fall back to
  // their E2B metadata rather than locking their owner out.
  if (!touched && !(await isSandboxOwner(sbxId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await Sandbox.setTimeout(sbxId, PREVIEW_IDLE_TIMEOUT_MS, {
      apiKey: process.env.E2B_API_KEY,
    });
    return NextResponse.json({
      ok: true,
      timeoutMs: PREVIEW_IDLE_TIMEOUT_MS,
    });
  } catch (err) {
    const mapped = toSandboxErrorResponse(err);
    logger.warn(
      `[e2b] extend failed sbxId=${sbxId} code=${mapped.code} error=${errorLabel(err)}`,
    );
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status },
    );
  }
}
