import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { pgDb } from "lib/db/pg/db.pg";
import {
  TabularReviewTable,
  TabularReviewDocumentTable,
  TabularCellTable,
  DocumentTable,
} from "lib/db/pg/schema.pg";
import { eq, and } from "drizzle-orm";
import { exportToExcel } from "lib/tabular/export-to-excel";

export const GET = withAuth(
  async (_req, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id: reviewId } = await params;

    const [review] = await pgDb
      .select()
      .from(TabularReviewTable)
      .where(
        and(
          eq(TabularReviewTable.id, reviewId),
          eq(TabularReviewTable.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    const reviewDocs = await pgDb
      .select()
      .from(TabularReviewDocumentTable)
      .where(eq(TabularReviewDocumentTable.reviewId, reviewId))
      .orderBy(TabularReviewDocumentTable.rowIndex);

    const docRows = await pgDb
      .select({ id: DocumentTable.id, filename: DocumentTable.filename })
      .from(DocumentTable)
      .where(eq(DocumentTable.userId, session.user.id));

    const cells = await pgDb
      .select()
      .from(TabularCellTable)
      .where(eq(TabularCellTable.reviewId, reviewId));

    const columns = review.columns as { id: string; label: string }[];

    const rows = reviewDocs.map((rd) => {
      const docFilename =
        docRows.find((d) => d.id === rd.documentId)?.filename ?? rd.documentId;
      const docCells = cells.filter((c) => c.documentId === rd.documentId);
      const cellMap = Object.fromEntries(
        docCells.map((c) => [c.columnId, c.value]),
      );
      return { documentTitle: docFilename, cells: cellMap };
    });

    const buffer = await exportToExcel({ title: review.title, columns, rows });

    const safeName = review.title.replace(/[^a-z0-9_-]/gi, "_").slice(0, 50);
    return new Response(buffer.buffer as ArrayBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
      },
    });
  },
);
