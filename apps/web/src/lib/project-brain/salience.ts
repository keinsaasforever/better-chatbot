import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import { sql } from "drizzle-orm";

/**
 * salience = ln(1 + degree) + 0.5·ln(1 + currentFacts) + recency(30d)
 *          + 0.3·distinctSourceScopes
 *
 * Degree counts links with current evidence in either direction. Recency
 * decays linearly from 1 (observed now) to 0 (30 days or older). The score
 * orders the graph, boosts retrieval and picks consolidation context.
 */
export async function recomputeProjectSalience(projectId: string) {
  const result = await pgDb.execute(sql`
    WITH degree AS (
      SELECT page_id, count(*)::int AS degree
      FROM (
        SELECT l.from_page_id AS page_id
        FROM project_brain_link l
        WHERE l.project_id = ${projectId}
          AND EXISTS (SELECT 1 FROM project_brain_link_evidence e WHERE e.link_id = l.id AND e.status = 'current')
        UNION ALL
        SELECT l.to_page_id
        FROM project_brain_link l
        WHERE l.project_id = ${projectId}
          AND EXISTS (SELECT 1 FROM project_brain_link_evidence e WHERE e.link_id = l.id AND e.status = 'current')
      ) ends
      GROUP BY page_id
    ),
    facts AS (
      SELECT page_id,
             count(*)::int AS facts,
             max(last_observed_at) AS last_observed,
             count(DISTINCT source_scope)::int AS scopes
      FROM project_brain_fact
      WHERE project_id = ${projectId} AND status = 'current'
      GROUP BY page_id
    ),
    scored AS (
      SELECT p.id,
             ln(1 + COALESCE(d.degree, 0))
             + 0.5 * ln(1 + COALESCE(f.facts, 0))
             + GREATEST(0, 1 - EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - COALESCE(f.last_observed, p.updated_at))) / (30 * 86400))
             + 0.3 * COALESCE(f.scopes, 0) AS score
      FROM project_brain_page p
      LEFT JOIN degree d ON d.page_id = p.id
      LEFT JOIN facts f ON f.page_id = p.id
      WHERE p.project_id = ${projectId}
    )
    UPDATE project_brain_page p
    SET salience = ROUND(scored.score::numeric, 3)
    FROM scored
    WHERE p.id = scored.id
      AND p.salience IS DISTINCT FROM ROUND(scored.score::numeric, 3)
  `);
  return {
    updated: Number((result as unknown as { count?: number }).count ?? 0),
  };
}

const STALE_DAYS = 30;

/**
 * Pages with no current facts and no current evidence for 30 days are
 * archived (hidden from graph, retrieval and consolidation), never deleted.
 */
export async function archiveStalePages(projectId: string) {
  const rows = (await pgDb.execute(sql`
    UPDATE project_brain_page p
    SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE p.project_id = ${projectId}
      AND p.archived_at IS NULL
      AND p.type <> 'overview'
      AND p.updated_at < CURRENT_TIMESTAMP - INTERVAL '${sql.raw(String(STALE_DAYS))} days'
      AND NOT EXISTS (
        SELECT 1 FROM project_brain_fact f WHERE f.page_id = p.id AND f.status = 'current'
      )
      AND NOT EXISTS (
        SELECT 1 FROM project_brain_link l
        JOIN project_brain_link_evidence e ON e.link_id = l.id AND e.status = 'current'
        WHERE l.from_page_id = p.id OR l.to_page_id = p.id
      )
    RETURNING p.id
  `)) as unknown as Array<{ id: string }>;
  return { archived: rows.length };
}
