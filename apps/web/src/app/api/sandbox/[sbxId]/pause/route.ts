import { Sandbox } from "@e2b/code-interpreter";
import { getSession } from "auth/server";
import { pgSandboxSessionRepository } from "lib/db/pg/repositories/sandbox-session-repository.pg";
import { errorLabel, toSandboxErrorResponse } from "lib/e2b/create-sandbox";
import { isSandboxOwner } from "lib/e2b/sandbox-ownership";
import logger from "lib/logger";
import { NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * Pause a preview sandbox as soon as the user stops looking at it.
 *
 * E2B bills per second of *running* time only; a paused sandbox costs nothing,
 * is retained indefinitely, and keeps both filesystem and memory, resuming in
 * about a second when the iframe next requests it. So pausing early is free in
 * UX terms and is the main lever on the bill — previously a preview idled for
 * its full TTL (and, while the panel stayed open, was actively kept alive
 * forever by the heartbeat).
 *
 * Called from the artifact panel when the tab is hidden, the panel closes, or
 * the page unloads. The unload path uses `sendBeacon`/`keepalive`, which means:
 *
 * - the request may carry **no body and no custom headers**, so nothing here
 *   may parse the body; authentication rides on the session cookie, and
 * - it can fire **more than once** for the same sandbox, so pausing an
 *   already-paused sandbox must succeed rather than 5xx. The SDK returns
 *   `false` on the API's 409 for that case, which we surface as
 *   `alreadyPaused` rather than an error.
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

  // Ownership is resolved through Sandbox.getInfo, never Sandbox.connect —
  // connect auto-resumes a paused sandbox, which would bill compute purely to
  // authorize putting it back to sleep. See lib/e2b/sandbox-ownership.ts.
  if (!(await isSandboxOwner(sbxId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const paused = await Sandbox.pause(sbxId, {
      apiKey: process.env.E2B_API_KEY,
    });
    await pgSandboxSessionRepository.markState(sbxId, "paused").catch(() => {});
    return NextResponse.json({ ok: true, alreadyPaused: !paused });
  } catch (err) {
    const mapped = toSandboxErrorResponse(err);
    logger.warn(
      `[e2b] pause failed sbxId=${sbxId} code=${mapped.code} error=${errorLabel(err)}`,
    );
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status },
    );
  }
}
