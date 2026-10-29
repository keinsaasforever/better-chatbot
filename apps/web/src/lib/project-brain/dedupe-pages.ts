import "server-only";

import { customModelProvider, projectBrainModelId } from "@/lib/ai/models";
import { generateObjectResilient } from "@/lib/ai/resilient-object";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectBrainPageTable } from "@/lib/db/pg/schema.pg";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { matchAlias } from "./alias-match";
import { replaceProjectBrainChunks } from "./chunk";
import { mergePages } from "./merge-pages";
import { buildDedupeSystemPrompt } from "./prompts";

const MAX_PAIRS = 30;
const MAX_PAGES_FOR_TOKEN_SCAN = 300;
const TITLE_SIMILARITY = 0.45;
const TRUTH_EXCERPT = 600;

type PageRow = {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  compiled_truth: string;
  fact_count: number;
  created_at: string | Date;
  frontmatter: Record<string, unknown>;
};

type CandidatePair = { a: PageRow; b: PageRow; reason: string };

const DedupeVerdictSchema = z.object({
  pairs: z
    .array(
      z.object({
        a: z.string().uuid(),
        b: z.string().uuid(),
        same: z.boolean(),
        reason: z.string().max(300).optional(),
      }),
    )
    .default([]),
});

function pairKey(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function notSameAs(page: PageRow): Set<string> {
  const raw = page.frontmatter?.notSameAs;
  return new Set(
    Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : [],
  );
}

/** Candidate duplicate pairs for one project: trigram-close titles plus alias token subsets. */
export async function findDuplicateCandidates(
  projectId: string,
): Promise<CandidatePair[]> {
  const pages = (await pgDb.execute(sql`
    SELECT p.id, p.type, p.title, p.summary, p.compiled_truth, p.created_at, p.frontmatter,
      (SELECT count(*) FROM project_brain_fact f WHERE f.page_id = p.id AND f.status = 'current')::int AS fact_count
    FROM project_brain_page p
    WHERE p.project_id = ${projectId}
      AND p.archived_at IS NULL
      AND p.type IN ('person', 'organization', 'meeting', 'topic', 'concept', 'decision', 'task')
    ORDER BY p.updated_at DESC
    LIMIT ${MAX_PAGES_FOR_TOKEN_SCAN}
  `)) as unknown as PageRow[];

  const byId = new Map(pages.map((page) => [page.id, page]));
  const seen = new Set<string>();
  const pairs: CandidatePair[] = [];

  const push = (a: PageRow, b: PageRow, reason: string) => {
    if (a.id === b.id || a.type !== b.type) return;
    const key = pairKey(a.id, b.id);
    if (seen.has(key)) return;
    if (notSameAs(a).has(b.id) || notSameAs(b).has(a.id)) return;
    seen.add(key);
    pairs.push({ a, b, reason });
  };

  // 1. Trigram-close titles (needs pg_trgm, migration 0058).
  const similar = (await pgDb.execute(sql`
    SELECT a.id AS a_id, b.id AS b_id
    FROM project_brain_page a
    JOIN project_brain_page b
      ON a.project_id = b.project_id AND a.type = b.type AND a.id < b.id
    WHERE a.project_id = ${projectId}
      AND a.archived_at IS NULL AND b.archived_at IS NULL
      AND similarity(lower(a.title), lower(b.title)) > ${TITLE_SIMILARITY}
    LIMIT ${MAX_PAIRS}
  `)) as unknown as Array<{ a_id: string; b_id: string }>;

  for (const row of similar) {
    const a = byId.get(row.a_id);
    const b = byId.get(row.b_id);
    if (a && b) push(a, b, "title_similarity");
  }

  // 2. Alias token subsets for people and organizations.
  const named = pages.filter(
    (page) => page.type === "person" || page.type === "organization",
  );
  for (const page of named) {
    if (pairs.length >= MAX_PAIRS) break;
    const others = named.filter(
      (other) => other.id !== page.id && other.type === page.type,
    );
    const match = matchAlias(
      {
        entityType: page.type,
        title: page.title,
        email:
          typeof page.frontmatter?.email === "string"
            ? page.frontmatter.email
            : null,
        domain:
          typeof page.frontmatter?.domain === "string"
            ? page.frontmatter.domain
            : null,
      },
      others.map((other) => ({
        pageId: other.id,
        normalizedAlias: other.title.toLowerCase(),
        email:
          typeof other.frontmatter?.email === "string"
            ? other.frontmatter.email
            : null,
        domain:
          typeof other.frontmatter?.domain === "string"
            ? other.frontmatter.domain
            : null,
      })),
    );
    if (match) {
      const other = byId.get(match.pageId);
      if (other) push(page, other, match.reason);
    }
  }

  return pairs.slice(0, MAX_PAIRS);
}

function excerpt(page: PageRow) {
  return {
    id: page.id,
    type: page.type,
    title: page.title,
    summary: page.summary ?? "",
    facts: page.compiled_truth.slice(0, TRUTH_EXCERPT),
    factCount: page.fact_count,
  };
}

/**
 * One model call judges all candidate pairs; confirmed pairs are merged (the
 * page with more facts survives, ties go to the older page), rejected pairs
 * are remembered in frontmatter so they are not asked again.
 */
export async function dedupeProjectPages(input: {
  projectId: string;
  timeoutMs?: number;
}) {
  const candidates = await findDuplicateCandidates(input.projectId);
  if (!candidates.length) return { candidates: 0, merged: 0, rejected: 0 };

  const { object } = await generateObjectResilient({
    model: projectBrainModelId,
    fallbackModel: customModelProvider.getModel(),
    label: `project-dedupe:${input.projectId}`,
    schema: DedupeVerdictSchema,
    abortSignal: input.timeoutMs
      ? AbortSignal.timeout(input.timeoutMs)
      : undefined,
    system: buildDedupeSystemPrompt(),
    prompt: JSON.stringify({
      pairs: candidates.map((pair) => ({
        reason: pair.reason,
        a: excerpt(pair.a),
        b: excerpt(pair.b),
      })),
    }),
  });

  const byKey = new Map(
    candidates.map((pair) => [pairKey(pair.a.id, pair.b.id), pair]),
  );

  let merged = 0;
  let rejected = 0;

  for (const verdict of object.pairs) {
    const pair = byKey.get(pairKey(verdict.a, verdict.b));
    if (!pair) continue;

    if (!verdict.same) {
      rejected++;
      for (const [page, other] of [
        [pair.a, pair.b],
        [pair.b, pair.a],
      ] as const) {
        await pgDb
          .update(ProjectBrainPageTable)
          .set({
            frontmatter: sql`jsonb_set(
              ${ProjectBrainPageTable.frontmatter},
              '{notSameAs}',
              (COALESCE(${ProjectBrainPageTable.frontmatter}->'notSameAs', '[]'::jsonb) || to_jsonb(${other.id}::text)),
              true
            )`,
          })
          .where(
            and(
              eq(ProjectBrainPageTable.id, page.id),
              isNull(ProjectBrainPageTable.archivedAt),
            ),
          );
      }
      continue;
    }

    const survivorFirst =
      pair.a.fact_count !== pair.b.fact_count
        ? pair.a.fact_count > pair.b.fact_count
        : new Date(pair.a.created_at) <= new Date(pair.b.created_at);
    const survivor = survivorFirst ? pair.a : pair.b;
    const loser = survivorFirst ? pair.b : pair.a;

    await pgDb.transaction(async (tx) => {
      await mergePages(tx, {
        projectId: input.projectId,
        survivorId: survivor.id,
        loserId: loser.id,
      });
    });

    // Re-embed the survivor outside the transaction; an embedding failure
    // must not undo the merge.
    try {
      const [page] = await pgDb
        .select()
        .from(ProjectBrainPageTable)
        .where(eq(ProjectBrainPageTable.id, survivor.id))
        .limit(1);
      if (page) {
        await replaceProjectBrainChunks({
          projectId: input.projectId,
          userId: page.userId,
          pageId: page.id,
          chunkType: "compiled_truth",
          text: [page.title, page.summary, page.compiledTruth]
            .filter(Boolean)
            .join("\n\n"),
          metadata: { slug: page.slug, type: page.type, title: page.title },
        });
      }
    } catch (error) {
      console.warn("[project-brain] re-embed after merge failed", error);
    }

    merged++;
  }

  return { candidates: candidates.length, merged, rejected };
}
