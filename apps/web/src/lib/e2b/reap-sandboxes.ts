import "server-only";
import { Sandbox } from "@e2b/code-interpreter";
import { pgSandboxSessionRepository } from "lib/db/pg/repositories/sandbox-session-repository.pg";
import { errorLabel, isPreviewTemplate } from "lib/e2b/create-sandbox";
import logger from "lib/logger";

/**
 * Backstop for sandboxes the browser never got to pause.
 *
 * The client pauses on tab-hide, panel close and unload, but none of that runs
 * if the tab crashes, the laptop lid closes, or the network drops — and E2B
 * keeps billing a running sandbox regardless. This sweeps up what the client
 * missed.
 *
 * Deliberately pauses rather than kills: a paused sandbox is free, keeps its
 * filesystem and memory, and resumes in about a second, so reaping one a user
 * still cares about is invisible to them.
 */

/** Nothing has extended the sandbox in this long — nobody is watching it. */
const IDLE_BEFORE_MS = 10 * 60 * 1000;

/** Rows considered per run. Bounds the work against the route's maxDuration. */
const BATCH_LIMIT = 200;

/** Pagination guard so a large account cannot run the route past its budget. */
const MAX_PAGES = 20;

/** Paused this long with no return: storage hygiene, not a cost saving. */
const KILL_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface ReapResult {
  scanned: number;
  paused: number;
  killed: number;
  failed: number;
}

function apiOpts() {
  return { apiKey: process.env.E2B_API_KEY };
}

/**
 * Pause a sandbox and record it, tolerating the races that are normal here
 * (already paused, already killed, never existed).
 */
async function pauseAndRecord(sandboxId: string): Promise<boolean> {
  try {
    await Sandbox.pause(sandboxId, apiOpts());
    await pgSandboxSessionRepository
      .markState(sandboxId, "paused")
      .catch(() => {});
    return true;
  } catch (error) {
    // A sandbox that no longer exists is not a failure to fix — record it as
    // gone so the next run stops considering it.
    logger.warn(
      `[e2b] reaper could not pause sbxId=${sandboxId} error=${errorLabel(error)}`,
    );
    await pgSandboxSessionRepository
      .markState(sandboxId, "killed")
      .catch(() => {});
    return false;
  }
}

/** Drain a Sandbox.list paginator, bounded. */
async function listAll(
  state: "running" | "paused",
): Promise<Array<{ sandboxId: string; metadata: Record<string, string> }>> {
  // Sandbox.list returns a paginator, not an array: `hasNext` is a getter and
  // each `nextItems()` call fetches one page. Treating it as an array silently
  // sees only the first 100 sandboxes.
  const paginator = Sandbox.list({
    query: { state: [state] },
    limit: 100,
    ...apiOpts(),
  });

  const items: Array<{
    sandboxId: string;
    metadata: Record<string, string>;
  }> = [];

  for (let page = 0; page < MAX_PAGES && paginator.hasNext; page++) {
    const batch = await paginator.nextItems();
    for (const info of batch) {
      items.push({
        sandboxId: info.sandboxId,
        metadata: info.metadata ?? {},
      });
    }
  }

  if (paginator.hasNext) {
    logger.warn(
      `[e2b] reaper stopped at the ${MAX_PAGES}-page cap for state=${state}; some sandboxes were not considered`,
    );
  }

  return items;
}

export async function reapSandboxes(): Promise<ReapResult> {
  const result: ReapResult = { scanned: 0, paused: 0, killed: 0, failed: 0 };
  const now = Date.now();

  // 1. Rows we know about that nobody has touched. `lastActiveAt` is written
  //    by the heartbeat, so this is the precise signal.
  const idle = await pgSandboxSessionRepository.listIdleRunning({
    idleBefore: new Date(now - IDLE_BEFORE_MS),
    limit: BATCH_LIMIT,
  });
  result.scanned += idle.length;

  for (const row of idle) {
    if (await pauseAndRecord(row.sandboxId)) result.paused++;
    else result.failed++;
  }

  // 2. Sandboxes running at E2B with no row at all — created before the
  //    registry existed, or by a path that bypassed it.
  try {
    const running = await listAll("running");
    const known = await pgSandboxSessionRepository.findKnownIds(
      running.map((item) => item.sandboxId),
    );

    for (const item of running) {
      if (known.has(item.sandboxId)) continue;
      // Only ever touch previews. Execution sandboxes are killed by their own
      // `finally` in e2b-run.ts and may be mid-execution right now.
      const template = item.metadata.template;
      if (!template || !isPreviewTemplate(template)) continue;

      result.scanned++;
      if (await pauseAndRecord(item.sandboxId)) result.paused++;
      else result.failed++;
    }
  } catch (error) {
    logger.error(`[e2b] reaper orphan sweep failed error=${errorLabel(error)}`);
  }

  // 3. Long-dormant paused sandboxes. These cost nothing, so this is cleanup
  //    rather than savings — and it is irreversible, hence the long window.
  const stale = await pgSandboxSessionRepository.listPausedBefore({
    before: new Date(now - KILL_AFTER_MS),
    limit: BATCH_LIMIT,
  });

  for (const row of stale) {
    try {
      await Sandbox.kill(row.sandboxId, apiOpts());
    } catch {
      // Already gone is the expected outcome here.
    }
    await pgSandboxSessionRepository
      .markState(row.sandboxId, "killed")
      .catch(() => {});
    result.killed++;
  }

  return result;
}
