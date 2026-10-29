import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { KnowledgeBaseTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { and, desc, eq, or } from "drizzle-orm";
import z from "zod";

const KnowledgeBaseCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).nullish(),
    visibility: z.enum(["public", "private"]).optional().default("private"),
  })
  .strip();

function readActiveOrganizationId(session: {
  session?: { activeOrganizationId?: string | null };
}) {
  return (
    (session.session as { activeOrganizationId?: string | null } | undefined)
      ?.activeOrganizationId ?? null
  );
}

/**
 * GET /api/knowledge-bases
 * Knowledge bases the caller may use (own + org-shared) plus the caller's own
 * projects (valid upload/binding targets — their namespaces provision lazily).
 */
export const GET = withAuth(async (_request, session) => {
  try {
    const activeOrganizationId = readActiveOrganizationId(session);

    // Org-shared rows only match inside the caller's active org; without an
    // active org the predicate collapses to owner-only (fails closed).
    const accessible = activeOrganizationId
      ? or(
          eq(KnowledgeBaseTable.userId, session.user.id),
          and(
            eq(KnowledgeBaseTable.visibility, "public"),
            eq(KnowledgeBaseTable.organizationId, activeOrganizationId),
          ),
        )
      : eq(KnowledgeBaseTable.userId, session.user.id);

    const [knowledgeBases, projects] = await Promise.all([
      pgDb
        .select()
        .from(KnowledgeBaseTable)
        .where(accessible)
        .orderBy(desc(KnowledgeBaseTable.createdAt)),
      pgDb
        .select({
          id: ProjectTable.id,
          name: ProjectTable.name,
          agentsetNamespaceId: ProjectTable.agentsetNamespaceId,
        })
        .from(ProjectTable)
        .where(eq(ProjectTable.ownerUserId, session.user.id))
        .orderBy(desc(ProjectTable.createdAt)),
    ]);

    return NextResponse.json({ knowledgeBases, projects });
  } catch (error) {
    console.error("Error listing knowledge bases:", error);
    return NextResponse.json(
      { error: "Failed to list knowledge bases" },
      { status: 500 },
    );
  }
});

/**
 * POST /api/knowledge-bases
 * Create a knowledge base. The Agentset namespace is provisioned lazily on
 * first upload.
 */
export const POST = withAuth(async (request, session) => {
  try {
    const parsed = KnowledgeBaseCreateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid knowledge base payload" },
        { status: 400 },
      );
    }

    const [knowledgeBase] = await pgDb
      .insert(KnowledgeBaseTable)
      .values({
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        userId: session.user.id,
        organizationId: readActiveOrganizationId(session),
        visibility: parsed.data.visibility,
      })
      .returning();

    return NextResponse.json({ knowledgeBase }, { status: 201 });
  } catch (error) {
    console.error("Error creating knowledge base:", error);
    return NextResponse.json(
      { error: "Failed to create knowledge base" },
      { status: 500 },
    );
  }
});
