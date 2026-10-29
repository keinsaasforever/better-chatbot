import "server-only";
import { tool as createTool } from "ai";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { createTabularReviewSchema } from "./create-tabular-review-tool";
import { pgDb } from "lib/db/pg/db.pg";
import {
  TabularReviewTable,
  TabularReviewDocumentTable,
  TabularCellTable,
} from "lib/db/pg/schema.pg";
import { resolveDocumentRef } from "@/lib/document/resolve-document-ref";

export const createTabularReviewToolWithExecute = (
  userId: string,
  projectId?: string | null,
) =>
  createTool({
    description: `Create a multi-document tabular review table.
Use this when the user wants to compare multiple uploaded documents side-by-side, extract the same fields from each one, or produce a structured comparison (e.g., contract comparison, due diligence review, competitive analysis).

Each document becomes a row; each column extracts a specific piece of information from the document.

Available column presets: summary, key_dates, parties, obligations, risks, penalty, jurisdiction, custom.
Column types: text, date, boolean, list, score (0–10), citation.

After creating the table, cells are generated automatically — one LLM call per document per column.
The result is an interactive table that can be exported to Excel.`,
    inputSchema: jsonSchemaToZod(createTabularReviewSchema),
    execute: async ({ title, documentIds, columns }, options) => {
      // Abort (client disconnect / stop / timeout) short-circuits before each
      // I/O boundary so a cancelled run does not still write review rows.
      const abortSignal = options?.abortSignal;
      abortSignal?.throwIfAborted();
      const resolvedDocs = await Promise.all(
        documentIds.map((ref) =>
          resolveDocumentRef({ ref, userId, projectId }),
        ),
      );

      const allowed = resolvedDocs
        .filter((d): d is NonNullable<typeof d> => d !== null)
        .map((d) => d.id);

      const uniqueAllowed = [...new Set(allowed)];

      if (uniqueAllowed.length === 0) {
        return {
          error:
            "No accessible documents found. Use one of the documentId values listed in available_project_documents.",
        };
      }

      abortSignal?.throwIfAborted();
      const [review] = await pgDb
        .insert(TabularReviewTable)
        .values({ userId, title, columns })
        .returning();

      await pgDb.insert(TabularReviewDocumentTable).values(
        uniqueAllowed.map((docId, idx) => ({
          reviewId: review.id,
          documentId: docId,
          rowIndex: idx,
        })),
      );

      await pgDb.insert(TabularCellTable).values(
        uniqueAllowed.flatMap((docId) =>
          columns.map((col) => ({
            reviewId: review.id,
            documentId: docId,
            columnId: col.id,
            status: "pending" as const,
          })),
        ),
      );

      return {
        id: review.id,
        title: review.title,
        documentCount: uniqueAllowed.length,
        columnCount: columns.length,
      };
    },
  });
