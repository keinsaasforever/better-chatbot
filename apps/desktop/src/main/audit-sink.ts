import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Mirrors @keinsaas/audit — kept local so Electron main can load compiled JS only. */
export type AuditEvent = {
  id?: string;
  timestamp: string;
  actorId?: string;
  deviceId?: string;
  surface: "web" | "desktop" | "gateway" | "worker";
  action: string;
  resourceType: string;
  resourceId?: string;
  toolName?: string;
  argsHash?: string;
  resultHash?: string;
  outcome: "success" | "failure" | "denied";
  metadata?: Record<string, unknown>;
};

const AUDIT_DIR = join(homedir(), ".keinsaas-navigator", "audit");

function ensureAuditDir(): void {
  mkdirSync(AUDIT_DIR, { recursive: true });
}

export async function hashPayload(value: unknown): Promise<string> {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function createAuditEvent(
  input: Omit<AuditEvent, "timestamp"> & { timestamp?: string },
): AuditEvent {
  return {
    ...input,
    timestamp: input.timestamp ?? new Date().toISOString(),
  };
}

export function writeAuditEvent(
  input: Omit<AuditEvent, "timestamp" | "surface"> & {
    timestamp?: string;
  },
): AuditEvent {
  const event = createAuditEvent({
    ...input,
    surface: "desktop",
  });
  ensureAuditDir();
  const line = `${JSON.stringify(event)}\n`;
  appendFileSync(join(AUDIT_DIR, "events.ndjson"), line, "utf8");
  console.info("[audit]", event.action, event.toolName ?? event.resourceType);
  return event;
}

export function parseAuditEvent(input: unknown): AuditEvent {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid audit event");
  }
  const event = input as AuditEvent;
  if (!event.action || !event.resourceType || !event.outcome) {
    throw new Error("Invalid audit event");
  }
  return createAuditEvent({
    ...event,
    surface: event.surface ?? "desktop",
  });
}
