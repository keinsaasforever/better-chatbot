import "server-only";

import { customModelProvider, projectBrainModelId } from "@/lib/ai/models";
import { generateObjectResilient } from "@/lib/ai/resilient-object";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainContradictionTable } from "@/lib/db/pg/schema.pg";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { buildContradictionJudgePrompt } from "./prompts";

/**
 * gbrain "suspected contradictions": two current facts on the same page and
 * fact key with different values from different source scopes. SQL finds the
 * candidates, one batched model call judges them, verdicts are stored once
 * per pair so nothing is re-asked.
 */

export type ContradictionCandidate = {
  aId: string;
  bId: string;
  pageId: string;
  pageTitle: string;
  factKey: string;
  aValue: string;
  bValue: string;
  aScope: string;
  bScope: string;
  aObservedAt: string | Date;
  bObservedAt: string | Date;
};

const MAX_CANDIDATES = 40;
const MAX_PER_FACT_KEY = 3;

const VerdictSchema = z.object({
  verdicts: z
    .array(
      z.object({
        a: z.string().uuid(),
        b: z.string().uuid(),
        verdict: z
          .enum(["contradiction", "compatible", "unknown"])
          .catch("unknown"),
        explanation: z.string().max(400).optional(),
      }),
    )
    .default([]),
});

/** Cap pairs per (page, key) so one noisy fact cannot fill the batch. Pure, tested. */
export function limitCandidatesPerKey(
  candidates: ContradictionCandidate[],
  maxPerKey = MAX_PER_FACT_KEY,
): ContradictionCandidate[] {
  const seen = new Map<string, number>();
  const result: ContradictionCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.pageId}:${candidate.factKey}`;
    const count = seen.get(key) ?? 0;
    if (count >= maxPerKey) continue;
    seen.set(key, count + 1);
    result.push(candidate);
  }
  return result;
}

export async function findContradictionCandidates(
  projectId: string,
): Promise<ContradictionCandidate[]> {
  const rows = (await pgDb.execute(sql`
    SELECT a.id AS "aId", b.id AS "bId", a.page_id AS "pageId", p.title AS "pageTitle",
           a.fact_key AS "factKey", a.value AS "aValue", b.value AS "bValue",
           a.source_scope AS "aScope", b.source_scope AS "bScope",
           a.last_observed_at AS "aObservedAt", b.last_observed_at AS "bObservedAt"
    FROM project_brain_fact a
    JOIN project_brain_fact b
      ON b.page_id = a.page_id
     AND b.fact_key = a.fact_key
     AND b.id > a.id
     AND b.status = 'current'
     AND b.value_hash <> a.value_hash
     AND b.source_scope <> a.source_scope
    JOIN project_brain_page p ON p.id = a.page_id AND p.archived_at IS NULL
    WHERE a.project_id = ${projectId}
      AND a.status = 'current'
      AND a.fact_type IN ('attribute', 'status', 'decision')
      AND NOT EXISTS (
        SELECT 1 FROM project_brain_contradiction c
        WHERE (c.fact_id_a = a.id AND c.fact_id_b = b.id)
           OR (c.fact_id_a = b.id AND c.fact_id_b = a.id)
      )
    ORDER BY GREATEST(a.last_observed_at, b.last_observed_at) DESC
    LIMIT ${MAX_CANDIDATES * 2}
  `)) as unknown as ContradictionCandidate[];

  return limitCandidatesPerKey(rows).slice(0, MAX_CANDIDATES);
}

export async function detectProjectContradictions(input: {
  projectId: string;
  timeoutMs?: number;
}) {
  const candidates = await findContradictionCandidates(input.projectId);
  if (!candidates.length) {
    return { candidates: 0, contradictions: 0, compatible: 0, unknown: 0 };
  }

  const { object } = await generateObjectResilient({
    model: projectBrainModelId,
    fallbackModel: customModelProvider.getModel(),
    label: `project-contradictions:${input.projectId}`,
    schema: VerdictSchema,
    abortSignal: input.timeoutMs
      ? AbortSignal.timeout(input.timeoutMs)
      : undefined,
    system: buildContradictionJudgePrompt(),
    prompt: JSON.stringify({
      pairs: candidates.map((candidate) => ({
        a: candidate.aId,
        b: candidate.bId,
        page: candidate.pageTitle,
        factKey: candidate.factKey,
        aValue: candidate.aValue,
        aSource: candidate.aScope.split(":")[0],
        aObservedAt: new Date(candidate.aObservedAt).toISOString(),
        bValue: candidate.bValue,
        bSource: candidate.bScope.split(":")[0],
        bObservedAt: new Date(candidate.bObservedAt).toISOString(),
      })),
    }),
  });

  const byPair = new Map(
    candidates.map((candidate) => [
      `${candidate.aId}:${candidate.bId}`,
      candidate,
    ]),
  );
  const counts = { contradiction: 0, compatible: 0, unknown: 0 };
  const rows: (typeof ProjectBrainContradictionTable.$inferInsert)[] = [];

  for (const verdict of object.verdicts) {
    const candidate =
      byPair.get(`${verdict.a}:${verdict.b}`) ??
      byPair.get(`${verdict.b}:${verdict.a}`);
    if (!candidate) continue;
    counts[verdict.verdict]++;
    rows.push({
      projectId: input.projectId,
      pageId: candidate.pageId,
      factKey: candidate.factKey,
      factIdA: candidate.aId,
      factIdB: candidate.bId,
      verdict: verdict.verdict,
      explanation: verdict.explanation ?? null,
      // Only real contradictions need a human; the rest are closed on insert.
      status: verdict.verdict === "contradiction" ? "open" : "resolved",
    });
  }

  if (rows.length) {
    await pgDb
      .insert(ProjectBrainContradictionTable)
      .values(rows)
      .onConflictDoNothing();
  }

  return {
    candidates: candidates.length,
    contradictions: counts.contradiction,
    compatible: counts.compatible,
    unknown: counts.unknown,
  };
}
