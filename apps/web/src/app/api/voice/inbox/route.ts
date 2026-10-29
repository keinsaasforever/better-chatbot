import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { withAuth } from "auth/route-guard";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectTable, VoiceTranscriptTable } from "@/lib/db/pg/schema.pg";
import { VOICE_INBOX_NAME } from "@/lib/voice/project-resolver";

// GET: lightweight summary for the Projects-page Voice Inbox button.
// Returns the inbox project id (if it exists) and how many notes the AI
// parked there because it wasn't sure where they belonged. Does NOT create
// the inbox — merely loading the page should never create an empty project.
export const GET = withAuth(async (_request, session) => {
  const [inbox] = await pgDb
    .select({ id: ProjectTable.id })
    .from(ProjectTable)
    .where(
      and(
        eq(ProjectTable.ownerUserId, session.user.id),
        eq(ProjectTable.name, VOICE_INBOX_NAME),
      ),
    )
    .limit(1);

  if (!inbox) {
    return NextResponse.json({ projectId: null, count: 0 });
  }

  const [row] = await pgDb
    .select({ value: count() })
    .from(VoiceTranscriptTable)
    .where(
      and(
        eq(VoiceTranscriptTable.userId, session.user.id),
        eq(VoiceTranscriptTable.projectId, inbox.id),
      ),
    );

  return NextResponse.json({
    projectId: inbox.id,
    count: Number(row?.value ?? 0),
  });
});
