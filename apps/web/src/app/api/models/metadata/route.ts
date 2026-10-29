import { pgDb as db } from "lib/db/pg/db.pg";
import { ModelsTable } from "lib/db/pg/schema.pg";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withAuth } from "auth/route-guard";

/**
 * GET /api/models/metadata
 *
 * Returns all models where text=true with their metadata including:
 * - Developer name
 * - Country (for flag display)
 * - Badge flags (hiddenGem, speed, thinking, etc.)
 * - Catalog price per million input/output tokens
 *
 * Used by the enhanced model selector UI.
 *
 * The prices here are the `models` catalog figures — the product-facing ones.
 * `model_deployment` carries its own per-provider-path pricing for the
 * deterministic router, which can differ and is not what the menu should quote.
 */
export const GET = withAuth(async (_request, _session) => {
  try {
    const models = await db
      .select({
        model: ModelsTable.model,
        developer: ModelsTable.developer,
        country: ModelsTable.country,
        text: ModelsTable.text,
        hiddenGem: ModelsTable.hiddenGem,
        caution: ModelsTable.caution,
        notRecommended: ModelsTable.notRecommended,
        cheapAlternative: ModelsTable.cheapAlternative,
        speed: ModelsTable.speed,
        thinking: ModelsTable.thinking,
        maxPerformance: ModelsTable.maxPerformance,
        inputPriceUsd: ModelsTable.inputPriceUsd,
        outputPriceUsd: ModelsTable.outputPriceUsd,
      })
      .from(ModelsTable)
      .where(eq(ModelsTable.text, true));

    return NextResponse.json(models);
  } catch (error) {
    console.error("[API] Failed to fetch models metadata:", error);
    return NextResponse.json(
      { error: "Failed to fetch models metadata" },
      { status: 500 },
    );
  }
});
