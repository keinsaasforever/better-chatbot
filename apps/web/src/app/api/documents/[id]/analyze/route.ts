import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";
import { z } from "zod";
import { pgDb } from "lib/db/pg/db.pg";
import { DocumentTable } from "lib/db/pg/schema.pg";
import { eq, and } from "drizzle-orm";
import { serverFileStorage } from "lib/file-storage";
import { extractText } from "lib/document/extract-text";
import { generateText } from "ai";
import { ANTHROPIC_CACHE_CONTROL } from "lib/ai/prompt-cache";
import "lib/ai/register-gateway-provider";
import {
  buildCitationSystemPrompt,
  parseCitations,
} from "lib/citations/parse-citations";
import { aiTelemetry } from "lib/ai/telemetry";

export const maxDuration = 60;

const requestSchema = z.object({
  question: z.string().min(1).max(2000),
  modelId: z.string().optional(),
});

export const POST = withAuth(
  async (req, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id: documentId } = await params;
    const body = await req.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { question, modelId } = parsed.data;

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

    const fileBuffer = await serverFileStorage.download(doc.storageKey);
    const text = await extractText(fileBuffer, doc.contentType);

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Could not extract text from document" },
        { status: 422 },
      );
    }

    const systemPrompt = buildCitationSystemPrompt([
      { id: doc.id, title: doc.filename },
    ]);

    const model = modelId ?? "anthropic/claude-haiku-4.5";

    const { text: rawResponse } = await generateText({
      model: model as any,
      experimental_telemetry: aiTelemetry("doc.analyze", {
        modelId: String(model),
      }),
      // Cache breakpoint on the document: repeat questions about the same
      // document within the cache window read it back instead of re-paying for
      // the full text. The question stays outside the cached prefix.
      system: {
        role: "system",
        content: `${systemPrompt}\n\nDocument content:\n${text.slice(0, 80_000)}`,
        providerOptions: ANTHROPIC_CACHE_CONTROL,
      },
      prompt: question,
    });

    const { text: answer, citations } = parseCitations(rawResponse);

    return NextResponse.json({
      answer,
      citations,
      documentId,
      filename: doc.filename,
    });
  },
);
