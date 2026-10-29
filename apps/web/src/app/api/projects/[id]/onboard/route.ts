import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectMemberTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { isUserMemberOfOrganization } from "@/lib/organization/members";
import { enqueueProjectBrainRun } from "@/lib/project-brain/enqueue";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

const OnboardSchema = z.object({
  goal: z.string().trim().max(4000),
  memberUserIds: z.array(z.string().uuid()).max(30).default([]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const { actor } = await requireProjectAccess({
      projectId,
      minRole: "editor",
    });
    const parsed = OnboardSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "invalid_onboarding",
            message:
              parsed.error.issues[0]?.message ?? "Invalid onboarding data.",
          },
        },
        { status: 400 },
      );
    }

    await pgDb
      .update(ProjectTable)
      .set({
        goal: parsed.data.goal,
        onboardingCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(ProjectTable.id, projectId));

    if (parsed.data.memberUserIds.length) {
      const membershipChecks = await Promise.all(
        parsed.data.memberUserIds.map((userId) =>
          isUserMemberOfOrganization(actor.organizationId, userId).then(
            (isMember) => (isMember ? userId : null),
          ),
        ),
      );
      const validUserIds = membershipChecks.filter(
        (userId): userId is string => userId !== null,
      );

      if (validUserIds.length) {
        await pgDb
          .insert(ProjectMemberTable)
          .values(
            validUserIds.map((userId) => ({
              projectId,
              userId,
              role: "editor" as const,
            })),
          )
          .onConflictDoNothing({
            target: [ProjectMemberTable.projectId, ProjectMemberTable.userId],
          });
      }
    }

    const run = await enqueueProjectBrainRun({
      projectId,
      actorUserId: actor.userId,
      sourceType: "manual",
      sourceRef: `onboarding:${projectId}`,
      sourceScope: `onboarding:${projectId}`,
      trigger: "onboarding",
      idempotencyKey: `onboarding:${projectId}:${new Date()
        .toISOString()
        .slice(0, 16)}`,
    });

    return NextResponse.json({ runId: run.id }, { status: 202 });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
