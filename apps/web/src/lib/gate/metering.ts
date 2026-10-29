import type { UsageEvent } from "./types";

/**
 * Community metering surface: nothing is metered.
 *
 * Mirrors the cloud module's exports so tool code can call it unchanged. Kept
 * free of "server-only" for the same reason the cloud version is — it is
 * reachable from client components.
 */

export async function checkMeteredFeature(
  _featureId: string,
  _input: { customerId?: string | null; entityId?: string } = {},
): Promise<boolean> {
  return true;
}

export async function trackUsage(_event: UsageEvent): Promise<void> {}
