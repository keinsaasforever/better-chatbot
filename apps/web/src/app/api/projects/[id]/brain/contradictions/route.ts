import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainContradictionTable,
  ProjectBrainFactTable,
  ProjectBrainPageTable,
} from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";
import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

// GET: open contradictions the dream cycle found, with both fact values.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    await requireProjectAccess({ projectId });

    const rows = await pgDb
      .select({
        id: ProjectBrainContradictionTable.id,
        pageId: ProjectBrainContradictionTable.pageId,
        pageTitle: ProjectBrainPageTable.title,
        factKey: ProjectBrainContradictionTable.factKey,
        factIdA: ProjectBrainContradictionTable.factIdA,
        factIdB: ProjectBrainContradictionTable.factIdB,
        verdict: ProjectBrainContradictionTable.verdict,
        explanation: ProjectBrainContradictionTable.explanation,
        status: ProjectBrainContradictionTable.status,
        createdAt: ProjectBrainContradictionTable.createdAt,
      })
      .from(ProjectBrainContradictionTable)
      .innerJoin(
        ProjectBrainPageTable,
        eq(ProjectBrainPageTable.id, ProjectBrainContradictionTable.pageId),
      )
      .where(
        and(
          eq(ProjectBrainContradictionTable.projectId, projectId),
          eq(ProjectBrainContradictionTable.status, "open"),
          eq(ProjectBrainContradictionTable.verdict, "contradiction"),
        ),
      )
      .orderBy(desc(ProjectBrainContradictionTable.createdAt))
      .limit(50);

    const factIds = [
      ...new Set(rows.flatMap((row) => [row.factIdA, row.factIdB])),
    ];
    const facts = factIds.length
      ? await pgDb
          .select({
            id: ProjectBrainFactTable.id,
            value: ProjectBrainFactTable.value,
            sourceScope: ProjectBrainFactTable.sourceScope,
            observedAt: ProjectBrainFactTable.lastObservedAt,
          })
          .from(ProjectBrainFactTable)
          .where(inArray(ProjectBrainFactTable.id, factIds))
      : [];
    const factById = new Map(facts.map((fact) => [fact.id, fact]));

    const serializeFact = (id: string) => {
      const fact = factById.get(id);
      return fact
        ? {
            value: fact.value,
            sourceScope: fact.sourceScope,
            observedAt: fact.observedAt.toISOString(),
          }
        : null;
    };

    return NextResponse.json({
      contradictions: rows.map((row) => ({
        id: row.id,
        pageId: row.pageId,
        pageTitle: row.pageTitle,
        factKey: row.factKey,
        explanation: row.explanation,
        a: serializeFact(row.factIdA),
        b: serializeFact(row.factIdB),
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
