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
import { serverFileStorage } from "lib/file-storage";
import { extractText } from "lib/document/extract-text";
import {
  resolveColumnPrompt,
  formatPromptSuffix,
} from "lib/tabular/column-presets";
import { generateText } from "ai";
import { ANTHROPIC_CACHE_CONTROL } from "lib/ai/prompt-cache";
import "lib/ai/register-gateway-provider";
import { cellKey, collectAnsweredCells } from "lib/tabular/cell-completion";
import type { ColumnType } from "lib/tabular/column-presets";
import { aiTelemetry } from "lib/ai/telemetry";

export const maxDuration = 300;

const MODEL_ID = "anthropic/claude-haiku-4.5";

type ReviewColumn = {
  id: string;
  label: string;
  type: ColumnType;
  preset?: string;
  prompt?: string;
};

export const POST = withAuth(
  async (req, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id: reviewId } = await params;

    // The client POSTs without a body, so an unparseable body is the norm.
    const body = (await req.json().catch(() => null)) as {
      force?: boolean;
    } | null;
    const force = body?.force === true;

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

    const columns = review.columns as ReviewColumn[];

    const reviewDocs = await pgDb
      .select({
        documentId: TabularReviewDocumentTable.documentId,
        rowIndex: TabularReviewDocumentTable.rowIndex,
      })
      .from(TabularReviewDocumentTable)
      .where(eq(TabularReviewDocumentTable.reviewId, reviewId))
      .orderBy(TabularReviewDocumentTable.rowIndex);

    // A cell that already holds an answer must not be generated again. The card
    // remounts every time the thread is reopened, and generation used to start
    // unconditionally - so reopening a 40 cell review paid for 40 more model
    // calls. `force` is the deliberate way to regenerate anyway. This is the
    // authoritative half: it also covers a POST that does not come from the
    // card.
    const answered = force
      ? new Map<string, string>()
      : collectAnsweredCells(
          await pgDb
            .select({
              documentId: TabularCellTable.documentId,
              columnId: TabularCellTable.columnId,
              value: TabularCellTable.value,
              status: TabularCellTable.status,
            })
            .from(TabularCellTable)
            .where(eq(TabularCellTable.reviewId, reviewId)),
        );

    await pgDb
      .update(TabularReviewTable)
      .set({ status: "generating", updatedAt: new Date() })
      .where(eq(TabularReviewTable.id, reviewId));

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: object) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        };

        const sendAnswered = (documentId: string, col: ReviewColumn) =>
          send({
            type: "cell_update",
            documentId,
            columnId: col.id,
            value: answered.get(cellKey(documentId, col.id)) ?? "",
            status: "done",
          });

        try {
          for (const { documentId } of reviewDocs) {
            const pending = columns.filter(
              (col) => !answered.has(cellKey(documentId, col.id)),
            );

            // Every column of this document is answered. Skip the download and
            // the text extraction too - nothing left here needs the file.
            if (pending.length === 0) {
              for (const col of columns) sendAnswered(documentId, col);
              send({ type: "row_complete", documentId });
              continue;
            }

            const [doc] = await pgDb
              .select()
              .from(DocumentTable)
              .where(eq(DocumentTable.id, documentId))
              .limit(1);

            if (!doc) continue;

            let docText = "";
            try {
              const buf = await serverFileStorage.download(doc.storageKey);
              docText = await extractText(buf, doc.contentType);
            } catch {
              docText = "";
            }

            const truncated = docText.slice(0, 80_000);

            for (const col of columns) {
              if (answered.has(cellKey(documentId, col.id))) {
                sendAnswered(documentId, col);
                continue;
              }

              const basePrompt = resolveColumnPrompt(col);
              const suffix = formatPromptSuffix(col.type);
              const fullPrompt = `${basePrompt}${suffix}`;

              await pgDb
                .update(TabularCellTable)
                .set({ status: "generating", updatedAt: new Date() })
                .where(
                  and(
                    eq(TabularCellTable.reviewId, reviewId),
                    eq(TabularCellTable.documentId, documentId),
                    eq(TabularCellTable.columnId, col.id),
                  ),
                );

              let value = "";
              let cellStatus: "done" | "error" = "done";

              try {
                const { text } = await generateText({
                  model: MODEL_ID as any,
                  experimental_telemetry: aiTelemetry(
                    "tabular-review.cell.generate",
                    { modelId: MODEL_ID },
                  ),
                  system: `You are a document analyst. Answer questions about the provided document precisely and concisely.`,
                  messages: [
                    {
                      role: "user",
                      content: [
                        // Identical for every column of this document, and
                        // marked as a cache breakpoint: the first column pays
                        // for the document, the rest read it back at ~a tenth
                        // of the price. Columns are the inner loop, so they all
                        // land inside the 5 minute cache window.
                        {
                          type: "text",
                          text: `Document: "${doc.filename}"\n\n${truncated}`,
                          providerOptions: ANTHROPIC_CACHE_CONTROL,
                        },
                        // Only this varies per column.
                        { type: "text", text: `---\n\n${fullPrompt}` },
                      ],
                    },
                  ],
                });
                value = text.trim();
              } catch (err) {
                value = `Error: ${err instanceof Error ? err.message : "Unknown error"}`;
                cellStatus = "error";
              }

              await pgDb
                .update(TabularCellTable)
                .set({ value, status: cellStatus, updatedAt: new Date() })
                .where(
                  and(
                    eq(TabularCellTable.reviewId, reviewId),
                    eq(TabularCellTable.documentId, documentId),
                    eq(TabularCellTable.columnId, col.id),
                  ),
                );

              send({
                type: "cell_update",
                documentId,
                columnId: col.id,
                value,
                status: cellStatus,
              });
            }

            send({ type: "row_complete", documentId });
          }

          await pgDb
            .update(TabularReviewTable)
            .set({ status: "done", updatedAt: new Date() })
            .where(eq(TabularReviewTable.id, reviewId));

          send({ type: "complete" });
        } catch (err) {
          await pgDb
            .update(TabularReviewTable)
            .set({ status: "error", updatedAt: new Date() })
            .where(eq(TabularReviewTable.id, reviewId));

          send({
            type: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },
);

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
      .select({
        documentId: TabularReviewDocumentTable.documentId,
        rowIndex: TabularReviewDocumentTable.rowIndex,
      })
      .from(TabularReviewDocumentTable)
      .where(eq(TabularReviewDocumentTable.reviewId, reviewId))
      .orderBy(TabularReviewDocumentTable.rowIndex);

    const docIds = reviewDocs.map((r) => r.documentId);

    const docRows =
      docIds.length > 0
        ? await pgDb
            .select({ id: DocumentTable.id, filename: DocumentTable.filename })
            .from(DocumentTable)
            .where(eq(DocumentTable.userId, session.user.id))
        : [];

    const cells = await pgDb
      .select()
      .from(TabularCellTable)
      .where(eq(TabularCellTable.reviewId, reviewId));

    return NextResponse.json({
      review,
      documents: reviewDocs.map((rd) => ({
        ...rd,
        filename: docRows.find((d) => d.id === rd.documentId)?.filename ?? "",
      })),
      cells,
    });
  },
);
