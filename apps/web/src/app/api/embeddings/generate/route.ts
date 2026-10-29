import { requireBillingContext, trackUsage } from "@/lib/gate";
import { randomUUID } from "node:crypto";
import { embedRagText } from "@/lib/ai/rag/embed-rag";
import {
  RAG_EMBEDDING_MODEL_ID,
  RAG_EMBEDDING_PROVIDER,
} from "@/lib/ai/rag/embedding-models";
import { withAuth } from "auth/route-guard";
import { NextResponse } from "next/server";

export const POST = withAuth(async (request, session) => {
  try {
    const { text } = await request.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 },
      );
    }

    const result = await embedRagText(text);

    if (result.usage?.tokens) {
      const billing = await requireBillingContext().catch(() => ({
        customerId: session.user.id,
        userId: session.user.id,
        entityId: undefined,
      }));
      await trackUsage({
        kind: "tokens",
        customerId: billing.customerId,
        entityId: billing.entityId,
        modelId: `${RAG_EMBEDDING_PROVIDER}/${RAG_EMBEDDING_MODEL_ID}`,
        promptTokens: result.usage.tokens,
        completionTokens: 0,
        idempotencyKey: `embedding:${billing.customerId}:${randomUUID()}`,
        properties: { route: "/api/embeddings/generate" },
      });
    }

    return NextResponse.json({
      embedding: result.embedding,
      model: RAG_EMBEDDING_MODEL_ID,
      usage: result.usage,
    });
  } catch (error) {
    console.error("Failed to generate embedding:", error);
    return NextResponse.json(
      { error: "Failed to generate embedding" },
      { status: 500 },
    );
  }
});
