import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { z } from "zod";
import { pgDb } from "lib/db/pg/db.pg";
import {
  TabularReviewTable,
  TabularReviewDocumentTable,
  TabularCellTable,
  DocumentTable,
} from "lib/db/pg/schema.pg";
import { eq, desc } from "drizzle-orm";

const columnSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "date", "boolean", "list", "score", "citation"]),
  preset: z.string().optional(),
  prompt: z.string().optional(),
});

const createSchema = z.object({
  title: z.string().min(1).max(200),
  documentIds: z.array(z.string().uuid()).min(1).max(50),
  columns: z.array(columnSchema).min(1).max(20),
});

export const POST = withAuth(async (req, session) => {
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { title, documentIds, columns } = parsed.data;

  const docs = await pgDb
    .select({ id: DocumentTable.id })
    .from(DocumentTable)
    .where(eq(DocumentTable.userId, session.user.id));

  const ownedIds = new Set(docs.map((d) => d.id));
  const allowed = documentIds.filter((id) => ownedIds.has(id));
  if (allowed.length === 0) {
    return NextResponse.json(
      { error: "No accessible documents" },
      { status: 403 },
    );
  }

  const [review] = await pgDb
    .insert(TabularReviewTable)
    .values({ userId: session.user.id, title, columns })
    .returning();

  await pgDb.insert(TabularReviewDocumentTable).values(
    allowed.map((docId, idx) => ({
      reviewId: review.id,
      documentId: docId,
      rowIndex: idx,
    })),
  );

  await pgDb.insert(TabularCellTable).values(
    allowed.flatMap((docId) =>
      columns.map((col) => ({
        reviewId: review.id,
        documentId: docId,
        columnId: col.id,
        status: "pending" as const,
      })),
    ),
  );

  return NextResponse.json(
    { id: review.id, title: review.title },
    { status: 201 },
  );
});

export const GET = withAuth(async (_req, session) => {
  const reviews = await pgDb
    .select()
    .from(TabularReviewTable)
    .where(eq(TabularReviewTable.userId, session.user.id))
    .orderBy(desc(TabularReviewTable.createdAt))
    .limit(50);

  return NextResponse.json(reviews);
});
