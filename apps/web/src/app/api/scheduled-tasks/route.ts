import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ScheduledTaskTable, AgentTable } from "@/lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { agentRepository } from "@/lib/db/repository";
import {
  ScheduledTaskCreateSchema,
  computeNextRunAt,
  isValidCron,
} from "@/lib/scheduled-tasks/schedule-validation";
import { sanitizeCredentialAliases } from "@/lib/scheduled-tasks/browser-grants";
import { listScheduledTasksForUser } from "@/lib/scheduled-tasks/list-tasks";

/**
 * GET /api/scheduled-tasks
 * List all scheduled tasks for the current user
 */
export const GET = withAuth(async (request, session) => {
  try {
    // Optional ?agentId= filter; see listScheduledTasksForUser for why it
    // matters.
    const agentId = new URL(request.url).searchParams.get("agentId");
    const tasks = await listScheduledTasksForUser(session.user.id, { agentId });
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error("Error fetching scheduled tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch scheduled tasks" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/scheduled-tasks
 * Create a new scheduled task
 */
export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const parsed = ScheduledTaskCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid scheduled task payload" },
        { status: 400 },
      );
    }
    const {
      agentId,
      key,
      name,
      description,
      cronExpression,
      timezone,
      inputPrompt,
      browserAutomationEnabled,
      browserCredentialAliases,
      enabled,
    } = parsed.data;

    if (!isValidCron(cronExpression, timezone)) {
      return NextResponse.json(
        { error: "Invalid cron expression or timezone" },
        { status: 400 },
      );
    }

    // Access check, org-scoped. Uses the repository's shared predicate so an
    // org-shared agent can be scheduled (the old `userId === caller` check made
    // shared agents impossible to schedule), while still failing closed for
    // agents the caller can't reach.
    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null } | undefined
    )?.activeOrganizationId;
    const hasAccess = await agentRepository.checkAccess(
      agentId,
      session.user.id,
      false,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Agent not found or access denied" },
        { status: 404 },
      );
    }

    // Aliases name a capability, so they are checked against the org rather
    // than taken from the client.
    const grantedAliases = await sanitizeCredentialAliases({
      organizationId: activeOrganizationId,
      aliases: browserCredentialAliases,
    });

    const [agentRow] = await pgDb
      .select({ name: AgentTable.name })
      .from(AgentTable)
      .where(eq(AgentTable.id, agentId))
      .limit(1);

    // Upsert on (agent_id, key): re-saving a schedule updates it in place
    // instead of piling up duplicate rows.
    const [task] = await pgDb
      .insert(ScheduledTaskTable)
      .values({
        userId: session.user.id,
        taskType: "agent",
        agentId,
        key,
        name: name || `Scheduled ${agentRow?.name ?? "agent"}`,
        description: description || null,
        cronExpression,
        timezone,
        inputPrompt: inputPrompt || null,
        browserAutomationEnabled: browserAutomationEnabled ?? false,
        browserCredentialAliases: grantedAliases,
        enabled,
        nextRunAt: computeNextRunAt(cronExpression, timezone),
      })
      .onConflictDoUpdate({
        target: [ScheduledTaskTable.agentId, ScheduledTaskTable.key],
        set: {
          name: name || `Scheduled ${agentRow?.name ?? "agent"}`,
          description: description || null,
          cronExpression,
          timezone,
          inputPrompt: inputPrompt || null,
          ...(browserAutomationEnabled === undefined
            ? {}
            : { browserAutomationEnabled }),
          ...(grantedAliases === null
            ? {}
            : { browserCredentialAliases: grantedAliases }),
          enabled,
          nextRunAt: computeNextRunAt(cronExpression, timezone),
          updatedAt: new Date(),
        },
      })
      .returning();

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Error creating scheduled task:", error);
    return NextResponse.json(
      { error: "Failed to create scheduled task" },
      { status: 500 },
    );
  }
});
