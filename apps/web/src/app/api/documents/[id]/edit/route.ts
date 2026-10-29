import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { z } from "zod";
import { pgDb } from "lib/db/pg/db.pg";
import { DocumentTable, DocumentEditTable } from "lib/db/pg/schema.pg";
import { eq, and } from "drizzle-orm";
import { serverFileStorage } from "lib/file-storage";
import {
  applyTrackedEdits,
  resolveTrackedChange,
} from "lib/document/apply-tracked-edits";
import type { EditInput } from "lib/document/apply-tracked-edits";

export const maxDuration = 60;

const editInputSchema = z.object({
  find: z.string().default(""),
  replace: z.string().default(""),
  context_before: z.string().default(""),
  context_after: z.string().default(""),
  reason: z.string().optional(),
});

const applySchema = z.object({
  action: z.literal("apply"),
  edits: z.array(editInputSchema).min(1).max(50),
  author: z.string().optional(),
});

const resolveSchema = z.object({
  action: z.literal("resolve"),
  changeIds: z.array(z.string()).min(1),
  mode: z.enum(["accept", "reject"]),
});

const requestSchema = z.discriminatedUnion("action", [
  applySchema,
  resolveSchema,
]);

export const POST = withAuth(
  async (req, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id: documentId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const [doc] = await pgDb
      .select()
      .from(DocumentTable)
      .where(
        and(
          eq(DocumentTable.id, documentId),
          eq(DocumentTable.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!doc) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    const contentType = doc.contentType.toLowerCase();
    if (
      !contentType.includes("wordprocessingml") &&
      !contentType.includes("docx")
    ) {
      return NextResponse.json(
        { error: "Only DOCX files support tracked changes" },
        { status: 422 },
      );
    }

    const fileBuffer = await serverFileStorage.download(doc.storageKey);

    if (parsed.data.action === "apply") {
      const { edits, author } = parsed.data;
      const { bytes, changes, errors } = await applyTrackedEdits(
        fileBuffer,
        edits as EditInput[],
        { author: author ?? session.user.name ?? "AI Assistant" },
      );

      const uploadResult = await serverFileStorage.upload(bytes, {
        filename: `${doc.filename.replace(/\.docx$/i, "")}_tracked.docx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        userId: session.user.id,
        uploadType: "attachment",
      });

      if (changes.length > 0) {
        await pgDb.insert(DocumentEditTable).values(
          changes.map((c) => ({
            documentId: doc.id,
            userId: session.user.id,
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

      return NextResponse.json({
        storageKey: uploadResult.key,
        url: uploadResult.sourceUrl,
        changes,
        errors,
      });
    }

    if (parsed.data.action === "resolve") {
      const { changeIds, mode } = parsed.data;

      const editRows = await pgDb
        .select()
        .from(DocumentEditTable)
        .where(
          and(
            eq(DocumentEditTable.documentId, documentId),
            eq(DocumentEditTable.userId, session.user.id),
          ),
        );

      const storageKey = editRows[0]?.editedStorageKey ?? doc.storageKey;
      const sourceBuffer = await serverFileStorage.download(storageKey);

      const wIds: string[] = [];
      for (const cid of changeIds) {
        const row = editRows.find((r) => r.changeId === cid);
        if (row?.delWId) wIds.push(row.delWId);
        if (row?.insWId) wIds.push(row.insWId);
      }
      if (wIds.length === 0) {
        return NextResponse.json(
          { error: "Change IDs not found" },
          { status: 404 },
        );
      }

      const { bytes: resolvedBytes, found } = await resolveTrackedChange(
        sourceBuffer,
        wIds,
        mode,
      );

      const uploadResult = await serverFileStorage.upload(resolvedBytes, {
        filename: `${doc.filename.replace(/\.docx$/i, "")}_resolved.docx`,
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        userId: session.user.id,
        uploadType: "attachment",
      });

      const newStatus = mode === "accept" ? "accepted" : "rejected";
      for (const cid of changeIds) {
        const row = editRows.find((r) => r.changeId === cid);
        if (row) {
          await pgDb
            .update(DocumentEditTable)
            .set({
              status: newStatus,
              editedStorageKey: uploadResult.key,
              updatedAt: new Date(),
            })
            .where(eq(DocumentEditTable.id, row.id));
        }
      }

      return NextResponse.json({
        storageKey: uploadResult.key,
        url: uploadResult.sourceUrl,
        found,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  },
);
