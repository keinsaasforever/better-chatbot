/**
 * Shared vocabulary for the billing/entitlement seam.
 *
 * The cloud edition implements these against Autumn; the community edition
 * ships a no-op implementation. Nothing in here may import an edition-specific
 * module — this file is identical in both editions.
 */

/**
 * Who a metered action is billed to.
 *
 * `customerId` is null in the community edition (and for unauthenticated
 * callers): there is no billing customer, so metering is skipped while the
 * surrounding feature keeps working.
 */
export type BillingContext = {
  customerId: string | null;
  userId: string;
  entityId?: string;
  customerData: {
    email: string;
    name: string;
    image?: string | null;
  };
  organizationName?: string;
};

/** Entitlements that gate a feature rather than a credit balance. */
export type Feature = "local_models" | "exaai";

/** Who to bill, carried on every usage event. */
type UsageTarget = {
  customerId: string | null;
  entityId?: string;
  properties?: Record<string, any>;
};

/** A metered action that has already happened. Reported after the fact. */
export type UsageEvent = UsageTarget &
  (
    | {
        kind: "tokens";
        modelId: string;
        promptTokens: number;
        completionTokens: number;
        /**
         * The prompt-cache breakdown of `promptTokens`, straight from
         * `usage.inputTokenDetails`. Optional and purely additive: a caller
         * that omits them bills exactly as it did before cache pricing
         * existed.
         */
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        noCacheTokens?: number;
        /** Generated images, for models with a per-image price component. */
        imageCount?: number;
        idempotencyKey: string;
      }
    | {
        kind: "assemblyai";
        durationSeconds: number;
        sessionId: string;
      }
    | {
        kind: "agentset";
        parsedPages: number;
        documentId: string;
        idempotencyKey?: string;
      }
    | {
        kind: "exa";
        idempotencyKey: string;
      }
    | {
        kind: "e2b";
        executionTimeMs: number;
        vcpuCount: number;
        memoryMb: number;
        sandboxExecutionId: string;
      }
    | {
        /**
         * One Kernel browser run. `units` is whole headless-equivalent
         * seconds (see `lib/kernel/browser-contract.ts`), so a single Autumn
         * credit cost prices headless, headful and GPU browsers alike.
         */
        kind: "kernel";
        units: number;
        seconds: number;
        browserType: string;
        sessionId: string;
        /**
         * The tool call this segment belongs to. One browser session can span
         * several calls once a run parks for a human sign-in, so the session
         * id alone no longer identifies a billable run.
         */
        runId: string;
      }
    | {
        /**
         * One third-party (Composio) tool call. Counted, not priced — the
         * feature's credit cost starts at 0 while the volume is unknown.
         */
        kind: "toolCall";
        toolCallId: string;
        toolName: string;
      }
  );

/**
 * The credit position the chat surface nudges on. Only the hosted edition
 * produces one; the community edition never has a limit to reach.
 */
export type UsageLimitStatus = {
  isOverLimit: boolean;
  usage: number;
  includedUsage: number;
  /**
   * Whether the customer already holds the "pro" credit pack, which decides
   * whether the modal offers an upgrade or another top-up. Optional on purpose:
   * a status cached under the previous shape carries no value for it, and
   * "unknown" must read as "not pro" rather than as a type error.
   */
  hasProPlan?: boolean;
};

/** Payload for the account-created side effects (CRM sync in the cloud). */
export type CreatedUser = {
  id: string;
  email: string;
  name?: string | null;
};

/** An organization invitation that needs an email delivered. */
export type OrganizationInvitation = {
  email: string;
  invitedByUsername: string;
  invitedByEmail: string;
  teamName: string;
  inviteLink: string;
};

/** An internal notification to the operators of this instance. */
export type NotificationEmail = {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  body: string;
};

/** A password reset email that needs delivering. */
export type PasswordResetEmail = {
  email: string;
  name?: string | null;
  resetUrl: string;
};
