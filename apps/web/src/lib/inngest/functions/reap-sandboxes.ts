import { inngest } from "@/lib/inngest/client";
import { reapSandboxes } from "@/lib/e2b/reap-sandboxes";
import logger from "logger";

/**
 * Pauses E2B sandboxes the browser never got to pause itself.
 *
 * Every 5 minutes: often enough that a crashed tab wastes minutes rather than
 * hours, rare enough to stay well clear of E2B's API rate limits. The idle
 * threshold inside `reapSandboxes` is what actually decides staleness, so the
 * cadence only bounds how late the sweep can be.
 */
export const reapIdleSandboxes = inngest.createFunction(
  { id: "reap-idle-sandboxes" },
  { cron: "*/5 * * * *" },
  async () => {
    const result = await reapSandboxes();

    if (result.paused || result.killed || result.failed) {
      logger.info("[e2b] reaper tick", result);
    }

    return result;
  },
);
