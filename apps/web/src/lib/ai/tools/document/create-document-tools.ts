import "server-only";
import "../../../ai/register-gateway-provider";

import { tool as createTool } from "ai";
import { generateText } from "ai";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import {
  analyzeDocumentSchema,
  editDocumentSchema,
} from "./analyze-document-tool";
import { pgDb } from "lib/db/pg/db.pg";
import { DocumentTable, DocumentEditTable } from "lib/db/pg/schema.pg";
import { eq, and } from "drizzle-orm";
import { serverFileStorage } from "lib/file-storage";
import { extractText } from "lib/document/extract-text";
import { applyTrackedEdits } from "lib/document/apply-tracked-edits";
import type { EditInput } from "lib/document/apply-tracked-edits";
import {
  buildCitationSystemPrompt,
  parseCitations,
} from "lib/citations/parse-citations";
import { resolveDocumentRef } from "@/lib/document/resolve-document-ref";
import { aiTelemetry } from "lib/ai/telemetry";

export const createAnalyzeDocumentTool = (
  userId: string,
  projectId?: string | null,
) =>
  createTool({
    description: `Analyze the content of an uploaded document (PDF or DOCX).
Use this when the user references a document they have uploaded and asks you to summarize, explain, answer questions, or extract information from it.
Cite passages with [N] markers and collect all citations in a <CITATIONS> block at the end.`,
    inputSchema: jsonSchemaToZod(analyzeDocumentSchema),
    execute: async ({ documentId, question }) => {
      const doc = await resolveDocumentRef({
        ref: documentId,
        userId,
        projectId,
      });

      if (!doc) {
        return {
          error:
            "Document not found. Use one of the documentId values listed in available_project_documents.",
        };
      }

      let docText = "";
      try {
        const buf = await serverFileStorage.download(doc.storageKey);
        docText = await extractText(buf, doc.contentType);
      } catch {
        return { error: "Could not extract text from document." };
      }

      const systemPrompt = buildCitationSystemPrompt([
        { id: doc.id, title: doc.filename },
      ]);

      const { text: rawResponse } = await generateText({
        model: "anthropic/claude-haiku-4.5" as any,
        experimental_telemetry: aiTelemetry("tool.document.query", {
          modelId: "anthropic/claude-haiku-4.5",
        }),
        system: `${systemPrompt}\n\nDocument content:\n${docText.slice(0, 80_000)}`,
        prompt: question,
      });

      const { text: answer, citations: rawCitations } =
        parseCitations(rawResponse);
      const citations = rawCitations.map((c) => ({
        ...c,
        documentId: doc.id,
        documentTitle: c.documentTitle ?? doc.filename,
      }));
      return { answer, citations, documentId: doc.id, filename: doc.filename };
    },
  });

export const createEditDocumentTool = (userId: string, userName?: string) =>
  createTool({
    description: `Apply tracked changes to an uploaded DOCX document.
Use this when the user asks you to edit, revise, improve, or proofread a DOCX file.
First analyze the document with analyze-document to understand its text, then provide edits with verbatim context anchors.
The result is a new DOCX with tracked changes the user can accept or reject.`,
    inputSchema: jsonSchemaToZod(editDocumentSchema),
    execute: async ({ documentId, edits, author }) => {
      const [doc] = await pgDb
        .select()
        .from(DocumentTable)
        .where(
          and(
            eq(DocumentTable.id, documentId),
            eq(DocumentTable.userId, userId),
          ),
        )
        .limit(1);

      if (!doc) return { error: "Document not found or access denied." };

      const ct = doc.contentType.toLowerCase();
      if (!ct.includes("wordprocessingml") && !ct.includes("docx")) {
        return { error: "Only DOCX files support tracked changes." };
      }

      const fileBuffer = await serverFileStorage.download(doc.storageKey);
      const { bytes, changes, errors } = await applyTrackedEdits(
        fileBuffer,
        edits as EditInput[],
        { author: author ?? userName ?? "AI Assistant" },
      );

      const uploadResult = await serverFileStorage.upload(bytes, {
        filename: `${doc.filename.replace(/\.docx$/i, "")}_tracked.docx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        userId,
        uploadType: "attachment",
      });

      if (changes.length > 0) {
        await pgDb.insert(DocumentEditTable).values(
          changes.map((c) => ({
            documentId: doc.id,
            userId,
            changeId: c.id,
            delWId: c.delId,
            insWId: c.insId,
            deletedText: c.deletedText,
            insertedText: c.insertedText,
            contextBefore: c.contextBefore,
            contextAfter: c.contextAfter,
            reason: c.reason,
            editedStorageKey: uploadResult.key,
          })),
        );
      }

      return {
        documentId,
        storageKey: uploadResult.key,
        url: uploadResult.sourceUrl,
        changes,
        errors,
        message:
          changes.length > 0
            ? `Applied ${changes.length} tracked change${changes.length !== 1 ? "s" : ""}. ${errors.length > 0 ? `${errors.length} edit(s) could not be located.` : ""}`
            : "No changes could be applied. Check that find/context_before/context_after match the document text exactly.",
      };
    },
  });
