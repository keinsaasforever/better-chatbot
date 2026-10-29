import "server-only";

import { inngest } from "@/lib/inngest/client";

export const PROJECT_BRAIN_DREAM_EVENT =
  "project-brain/dream.requested" as const;

/**
 * Ask for one enrichment pass (dedupe, contradictions, salience, archive) on a
 * project. Idempotent per project and hour, so a manual trigger right after
 * the nightly one is a no-op.
 */
export async function enqueueProjectDream(input: {
  projectId: string;
  reason: "nightly" | "manual";
}) {
  const hour = new Date().toISOString().slice(0, 13);
  await inngest.send({
    id: `dream:${input.projectId}:${hour}`,
    name: PROJECT_BRAIN_DREAM_EVENT,
    data: { projectId: input.projectId, reason: input.reason },
  });
}
