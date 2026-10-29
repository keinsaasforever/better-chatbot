import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  DocumentTable,
  ProjectBrainEventTable,
  ProjectBrainFactTable,
  ProjectBrainLinkEvidenceTable,
  ProjectBrainLinkTable,
  ProjectBrainPageTable,
  ProjectBrainRawSourceTable,
  ProjectConnectedToolTable,
  VoiceTranscriptTable,
} from "@/lib/db/pg/schema.pg";
import {
  requireProjectAccess,
  toProjectErrorResponse,
} from "@/lib/projects/access";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: projectId } = await params;
    const { project, role } = await requireProjectAccess({ projectId });

    const [
      documents,
      tools,
      transcripts,
      pages,
      events,
      facts,
      links,
      sources,
    ] = await Promise.all([
      pgDb
        .select()
        .from(DocumentTable)
        .where(eq(DocumentTable.projectId, projectId))
        .orderBy(desc(DocumentTable.updatedAt)),
      pgDb
        .select()
        .from(ProjectConnectedToolTable)
        .where(eq(ProjectConnectedToolTable.projectId, projectId)),
      pgDb
        .select()
        .from(VoiceTranscriptTable)
        .where(eq(VoiceTranscriptTable.projectId, projectId))
        .orderBy(desc(VoiceTranscriptTable.createdAt))
        .limit(20),
      pgDb
        .select()
        .from(ProjectBrainPageTable)
        .where(eq(ProjectBrainPageTable.projectId, projectId))
        .orderBy(desc(ProjectBrainPageTable.updatedAt))
        .limit(100),
      pgDb
        .select()
        .from(ProjectBrainEventTable)
        .where(eq(ProjectBrainEventTable.projectId, projectId))
        .orderBy(desc(ProjectBrainEventTable.eventDate))
        .limit(50),
      pgDb
        .select()
        .from(ProjectBrainFactTable)
        .where(eq(ProjectBrainFactTable.projectId, projectId))
        .orderBy(desc(ProjectBrainFactTable.lastObservedAt))
        .limit(300),
      pgDb
        .select()
        .from(ProjectBrainLinkTable)
        .where(eq(ProjectBrainLinkTable.projectId, projectId)),
      pgDb
        .select()
        .from(ProjectBrainRawSourceTable)
        .where(eq(ProjectBrainRawSourceTable.projectId, projectId))
        .orderBy(desc(ProjectBrainRawSourceTable.observedAt))
        .limit(100),
    ]);

    const currentEvidence = await pgDb
      .select()
      .from(ProjectBrainLinkEvidenceTable)
      .where(eq(ProjectBrainLinkEvidenceTable.projectId, projectId));

    return NextResponse.json({
      project,
      role,
      documents,
      tools,
      transcripts,
      pages,
      events,
      facts,
      links,
      linkEvidence: currentEvidence.filter(
        (evidence) => evidence.status === "current",
      ),
      sources,
    });
  } catch (error) {
    return toProjectErrorResponse(error);
  }
}
