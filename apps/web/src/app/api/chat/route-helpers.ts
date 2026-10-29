import "server-only";
import { pgDb } from "@/lib/db/pg/db.pg";
import { MemberTable, UserTable } from "@/lib/db/pg/schema.pg";
import type { UserSession } from "@/types/user";
import { UIMessage } from "ai";
import { ChatAttachment } from "app-types/chat";
import { getSession } from "auth/server";
import { and, eq } from "drizzle-orm";
import {
  type ChatRunMode,
  SCHEDULED_TASK_ID_HEADER,
} from "@/lib/chat/run-mode";

/**
 * Turns a stored attachment path into a URL an external fetcher can read.
 *
 * The attachments bucket is served public-read, which is what lets model
 * providers — and a sandbox rendering a generated page — fetch the file with no
 * token. Already-absolute URLs and data: URIs pass through untouched.
 */
export function toPublicAttachmentUrl(url: string): string {
  if (!url || url.startsWith("http") || url.startsWith("data:")) return url;
  const supabaseUrl =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return url;
  return `${supabaseUrl}/storage/v1/object/public/attachments/${url}`;
}

/**
 * Resolves the request session, honouring the scheduled-task secret path.
 * Returns a Response (401/403) when auth fails so the caller can early-return,
 * or the authenticated session otherwise.
 *
 * `headless` marks a run with no browser attached — today the scheduled-task
 * loopback. Tool loading needs it: a client-side tool (one declared without an
 * `execute`) can never be answered on such a run. It is derived here, once,
 * from the same check that authenticates the request, so no other code has to
 * decide what a valid scheduled-task credential looks like.
 *
 * `runMode` is the separate question of whether a human is present — see
 * `lib/chat/run-mode`. It is set from the same verified branch, and
 * `scheduledTaskId` with it: the header carries only an id, and the route
 * re-reads the row, so a task's grants never travel inside the request they
 * authorize.
 */
export type ResolvedChatSession = {
  session: UserSession;
  headless: boolean;
  runMode: ChatRunMode;
  scheduledTaskId: string | null;
};

export async function resolveChatSession(
  request: Request,
): Promise<ResolvedChatSession | Response> {
  // Check for scheduled task authentication
  const scheduledTaskAuth = request.headers.get("X-Scheduled-Task-Auth");
  const scheduledTaskUserId = request.headers.get("X-User-Id");

  let session = await getSession();
  let headless = false;
  let runMode: ChatRunMode = "interactive";
  let scheduledTaskId: string | null = null;

  // If this is a scheduled task request, validate and load user from database
  if (scheduledTaskAuth && scheduledTaskUserId) {
    if (scheduledTaskAuth !== process.env.SCHEDULED_TASK_SECRET) {
      return new Response("Invalid scheduled task authentication", {
        status: 401,
      });
    }

    // Load actual user from database
    const user = await pgDb
      .select()
      .from(UserTable)
      .where(eq(UserTable.id, scheduledTaskUserId))
      .then((rows) => rows[0]);

    if (!user || user.banned) {
      return new Response("User not found or banned", { status: 403 });
    }

    // Scope the synthesized session to the agent's org so org model policy
    // and billing apply — but only after verifying the task owner really is a
    // member of that org. No header or no membership: org-less session.
    const requestedOrganizationId = request.headers.get("X-Organization-Id");
    let activeOrganizationId: string | null = null;
    if (requestedOrganizationId) {
      const [membership] = await pgDb
        .select({ id: MemberTable.id })
        .from(MemberTable)
        .where(
          and(
            eq(MemberTable.organizationId, requestedOrganizationId),
            eq(MemberTable.userId, user.id),
          ),
        )
        .limit(1);
      if (membership) {
        activeOrganizationId = requestedOrganizationId;
      }
    }

    // Build session from real database user
    session = {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        banned: user.banned,
        banReason: user.banReason,
        banExpires: user.banExpires,
        role: user.role,
      },
      session: {
        id: `scheduled-task-${Date.now()}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600000),
        token: "",
        ipAddress: null,
        userAgent: null,
        impersonatedBy: null,
        activeOrganizationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as UserSession;
    headless = true;
    runMode = "unattended";
    // Read only after the secret check above: this id selects which per-task
    // grants apply, so it must not be trusted from an unauthenticated caller.
    scheduledTaskId = request.headers.get(SCHEDULED_TASK_ID_HEADER);
  }

  if (!session?.user.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  return { session, headless, runMode, scheduledTaskId };
}

/**
 * Folds the CSV/PDF ingestion previews and file/source-url attachments into the
 * user message's parts, preserving the original insertion ordering (ingestion
 * previews before the last text part, attachments before the first text part).
 * Pure transform; returns the new parts array.
 */
export function buildMessageParts(
  currentParts: UIMessage["parts"],
  attachments: ChatAttachment[],
  ingestionPreviewParts: UIMessage["parts"],
): UIMessage["parts"] {
  let parts = currentParts;

  if (ingestionPreviewParts.length) {
    const baseParts = [...parts];
    let insertionIndex = -1;
    for (let i = baseParts.length - 1; i >= 0; i -= 1) {
      if (baseParts[i]?.type === "text") {
        insertionIndex = i;
        break;
      }
    }
    if (insertionIndex !== -1) {
      baseParts.splice(insertionIndex, 0, ...ingestionPreviewParts);
      parts = baseParts;
    } else {
      parts = [...baseParts, ...ingestionPreviewParts];
    }
  }

  if (attachments.length) {
    const firstTextIndex = parts.findIndex(
      (part: any) => part?.type === "text",
    );
    const attachmentParts: any[] = [];

    // Process attachments - handle PDFs specially (AI SDK requirement)
    for (const attachment of attachments) {
      const exists = parts.some(
        (part: any) =>
          part?.type === attachment.type && part?.url === attachment.url,
      );
      if (exists) continue;

      if (attachment.type === "file") {
        const { mediaType, url, filename } = attachment;

        const fileUrl = toPublicAttachmentUrl(url);

        // AI SDK expects 'data' field with URL object for PDFs and Images
        attachmentParts.push({
          type: "file",
          data: fileUrl.startsWith("data:") ? fileUrl : new URL(fileUrl),
          mediaType: mediaType,
          filename: filename,
        });
      } else if (attachment.type === "source-url") {
        attachmentParts.push({
          type: "source-url",
          sourceId: attachment.url,
          url: attachment.url,
          mediaType: attachment.mediaType,
          title: attachment.filename,
        });
      }
    }

    if (attachmentParts.length) {
      if (firstTextIndex >= 0) {
        parts = [
          ...parts.slice(0, firstTextIndex),
          ...attachmentParts,
          ...parts.slice(firstTextIndex),
        ];
      } else {
        parts = [...parts, ...attachmentParts];
      }
    }
  }

  return parts;
}

/**
 * Build the user-message parts that must be durable before model streaming
 * starts. Client-only attachment parts (notably CSV `source-url` parts) are
 * removed before the request is validated, so fold the separately validated
 * attachment metadata back in for the initial database write. This guarantees
 * that tools running during the stream can discover the current turn's files.
 */
export function buildInitialMessageParts(
  currentParts: UIMessage["parts"],
  attachments: ChatAttachment[],
): UIMessage["parts"] {
  return buildMessageParts(currentParts, attachments, []);
}

/**
 * Terminal state for a run that ended in streamText's `onAbort`.
 *
 * Every abort lands in that one callback: the detached stop the user asked for
 * *and* the SDK's own step/chunk/total timeouts, which fire through the same
 * abort signal. Only the first is a "stop". Recording a timeout as
 * `cancelled` made the UI say "This response was stopped." for a run the user
 * never touched — the 2026-09-08 trace `fd0141e9…` died on a 45s chunk timeout
 * mid-step and was reported exactly that way.
 */
export function resolveAbortOutcome({
  userStopped,
  reason,
}: {
  userStopped: boolean;
  reason?: unknown;
}): {
  runStatus: "cancelled" | "timed_out";
  error: { code: string; retryable: true };
  /** Present only for the unexpected case, so callers log it. */
  detail?: string;
} {
  if (userStopped) {
    return {
      runStatus: "cancelled",
      error: { code: "aborted", retryable: true },
    };
  }
  const detail =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : reason === undefined
        ? "no reason (budget exhausted: total/step/chunk/tool)"
        : String(reason);
  return {
    runStatus: "timed_out",
    error: { code: "run_timeout", retryable: true },
    detail,
  };
}
