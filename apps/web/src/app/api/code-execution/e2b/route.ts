import { requireBillingContext } from "@/lib/gate";
import { withAuth } from "auth/route-guard";
import { type E2BStagedFile, e2bRun } from "lib/code-runner/e2b-run";
import {
  collectAgentFiles,
  collectThreadAttachments,
  mergeStagedFiles,
} from "lib/code-runner/stage-attachments";
import { MAX_EXECUTION_TIMEOUT_MS } from "lib/code-runner/timeouts";
import { agentRepository } from "lib/db/repository";
import logger from "lib/logger";
import { NextResponse } from "next/server";
import { z } from "zod";

// Fluid Compute allows 300s by default; sandbox cold-start + code execution can
// exceed the platform-minimum 60s.
export const maxDuration = 300;

const requestSchema = z.object({
  code: z.string().min(1).max(200_000),
  type: z.enum(["javascript", "python"]),
  timeout: z.number().int().min(1000).max(MAX_EXECUTION_TIMEOUT_MS).optional(),
  // When present, the thread's uploaded attachments are staged into the sandbox
  // so code can open them by name. Ownership is verified server-side.
  threadId: z.string().min(1).max(256).optional(),
  // When present, the agent's bound files are staged too. The agent is loaded
  // through the repository's access check, so an id the caller may not use
  // simply yields no files.
  agentId: z.string().uuid().optional(),
});

export const POST = withAuth(async (req, session) => {
  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { code, type, timeout, threadId, agentId } = parsed.data;
  const billing = await requireBillingContext();

  // Stage the thread's attachments into the sandbox. Best-effort: a failure
  // here must not block code execution — the code simply runs without the files.
  let threadFiles: E2BStagedFile[] = [];
  if (threadId) {
    try {
      threadFiles = await collectThreadAttachments(threadId, session.user.id);
    } catch (err) {
      logger.warn(
        `[e2b] attachment staging failed threadId=${threadId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Same for the active agent's own files, so a run started from the browser
  // sees the same working directory a scheduled run would.
  let agentFiles: E2BStagedFile[] = [];
  if (agentId) {
    try {
      const activeOrganizationId = (
        session.session as { activeOrganizationId?: string | null } | undefined
      )?.activeOrganizationId;
      const agent = await agentRepository.selectAgentById(
        agentId,
        session.user.id,
        activeOrganizationId,
      );
      agentFiles = await collectAgentFiles(agent?.instructions?.files);
    } catch (err) {
      logger.warn(
        `[e2b] agent file staging failed agentId=${agentId} error=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const files = mergeStagedFiles(agentFiles, threadFiles);

  const result = await e2bRun(
    code,
    type,
    {
      userId: session.user.id,
      customerId: billing.customerId,
      entityId: billing.entityId,
    },
    timeout,
    files,
  );
  return NextResponse.json(result);
});
