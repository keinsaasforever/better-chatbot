import { trackUsage } from "@/lib/gate/metering";
import { pgDb } from "@/lib/db/pg/db.pg";
import { VoiceSessionTable, VoiceUsageEventTable } from "@/lib/db/pg/schema.pg";
import { eq, sql } from "drizzle-orm";
import { billingUsageEvents } from "lib/observability/instruments";

export async function trackVoiceAssemblyUsage(input: {
  voiceSessionId: string;
  billingCustomerId: string;
  billingEntityId?: string;
  seconds: number;
  idempotencyKey: string;
  properties?: Record<string, unknown>;
}) {
  const seconds = Math.ceil(input.seconds);
  if (seconds <= 0) {
    return;
  }

  const [usageEvent] = await pgDb
    .insert(VoiceUsageEventTable)
    .values({
      voiceSessionId: input.voiceSessionId,
      billingCustomerId: input.billingCustomerId,
      featureId: "assemblyai",
      quantity: seconds,
      idempotencyKey: input.idempotencyKey,
      status: "pending",
    })
    .onConflictDoNothing({
      target: VoiceUsageEventTable.idempotencyKey,
    })
    .returning({ id: VoiceUsageEventTable.id });

  if (!usageEvent) {
    // The deterministic idempotency key already claimed this event — a retry,
    // not a fault. Counted so a genuine spike is distinguishable from a
    // regression that starts double-inserting.
    billingUsageEvents.add(1, {
      feature: "assemblyai",
      outcome: "duplicate",
    });
    return;
  }

  try {
    await trackUsage({
      kind: "assemblyai",
      customerId: input.billingCustomerId,
      entityId: input.billingEntityId,
      durationSeconds: seconds,
      sessionId: input.idempotencyKey,
      properties: {
        voiceSessionId: input.voiceSessionId,
        source: "voice_device_streaming",
        ...input.properties,
      },
    });

    await pgDb
      .update(VoiceUsageEventTable)
      .set({ status: "tracked", trackedAt: new Date(), error: null })
      .where(eq(VoiceUsageEventTable.id, usageEvent.id));

    await pgDb
      .update(VoiceSessionTable)
      .set({
        billedAssemblyaiSeconds: sql`${VoiceSessionTable.billedAssemblyaiSeconds} + ${seconds}`,
        updatedAt: new Date(),
      })
      .where(eq(VoiceSessionTable.id, input.voiceSessionId));

    billingUsageEvents.add(1, { feature: "assemblyai", outcome: "tracked" });
  } catch (error: any) {
    await pgDb
      .update(VoiceUsageEventTable)
      .set({
        status: "failed",
        error: error?.message ?? "Failed to track AssemblyAI usage",
      })
      .where(eq(VoiceUsageEventTable.id, usageEvent.id));

    // Usage was consumed but never billed. This is the under-billing signal —
    // today it is only a row in a table nobody watches.
    billingUsageEvents.add(1, { feature: "assemblyai", outcome: "failed" });
    throw error;
  }
}
