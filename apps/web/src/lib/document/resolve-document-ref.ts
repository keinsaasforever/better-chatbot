import { and, eq } from "drizzle-orm";
import { pgDb } from "@/lib/db/pg/db.pg";
import { DocumentTable } from "@/lib/db/pg/schema.pg";
import { getProjectDocumentHandles } from "@/lib/ai/document-context";

export async function resolveDocumentRef(params: {
  ref: string;
  userId: string;
  projectId?: string | null;
}) {
  const direct = await pgDb
    .select()
    .from(DocumentTable)
    .where(
      and(
        eq(DocumentTable.id, params.ref),
        eq(DocumentTable.userId, params.userId),
      ),
    )
    .limit(1);

  if (direct[0]) return direct[0];

  const handles = await getProjectDocumentHandles({
    userId: params.userId,
    projectId: params.projectId,
  });

  const bySlug = handles.find((d) => d.slug === params.ref);
  const byName = handles.find((d) => d.filename === params.ref);
  const matched = bySlug ?? byName;

  if (!matched) return null;

  const [doc] = await pgDb
    .select()
    .from(DocumentTable)
    .where(
      and(
        eq(DocumentTable.id, matched.documentId),
        eq(DocumentTable.userId, params.userId),
      ),
    )
    .limit(1);

  return doc ?? null;
}
