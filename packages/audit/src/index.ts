import { z } from "zod";

export const AuditEventSchema = z.object({
  id: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
  actorId: z.string().optional(),
  deviceId: z.string().optional(),
  surface: z.enum(["web", "desktop", "gateway", "worker"]),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().optional(),
  toolName: z.string().optional(),
  argsHash: z.string().optional(),
  resultHash: z.string().optional(),
  outcome: z.enum(["success", "failure", "denied"]),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export async function hashPayload(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(value ?? null));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createAuditEvent(
  input: Omit<AuditEvent, "timestamp"> & { timestamp?: string },
): AuditEvent {
  return AuditEventSchema.parse({
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  });
}
