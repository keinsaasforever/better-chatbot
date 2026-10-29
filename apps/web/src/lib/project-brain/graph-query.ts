import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainAliasTable,
  ProjectBrainFactTable,
  ProjectBrainPageTable,
} from "@/lib/db/pg/schema.pg";
import { pgArray } from "@/lib/db/pg/sql-array";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { type ProjectEdgeType, isProjectEdgeType } from "./edge-types";

/**
 * gbrain-style graph queries over project_brain_page / project_brain_link:
 * entity lookup with backlinks, bounded multi-hop traversal, shortest path and
 * "who knows about X" expert routing. Only links with current evidence count;
 * archived (merged) pages are invisible.
 */

export type GraphPage = {
  id: string;
  type: string;
  title: string;
  summary: string | null;
  salience: number;
};

export type GraphLinkRow = {
  id: string;
  fromPageId: string;
  toPageId: string;
  linkType: ProjectEdgeType;
  confidence: number;
  context: string | null;
};

const MAX_LINKS_PER_PROJECT = 5000;

async function loadPages(
  projectId: string,
  ids: string[],
): Promise<GraphPage[]> {
  if (!ids.length) return [];
  const rows = await pgDb
    .select({
      id: ProjectBrainPageTable.id,
      type: ProjectBrainPageTable.type,
      title: ProjectBrainPageTable.title,
      summary: ProjectBrainPageTable.summary,
      salience: ProjectBrainPageTable.salience,
    })
    .from(ProjectBrainPageTable)
    .where(
      and(
        eq(ProjectBrainPageTable.projectId, projectId),
        inArray(ProjectBrainPageTable.id, ids),
        isNull(ProjectBrainPageTable.archivedAt),
      ),
    );
  return rows.map((row) => ({ ...row, salience: Number(row.salience) }));
}

/** Every link of the project that has at least one current evidence row. */
export async function loadCurrentLinks(
  projectId: string,
  pageIds?: string[],
): Promise<GraphLinkRow[]> {
  const scoped = pageIds?.length
    ? sql`AND (l.from_page_id = ANY(${pgArray(pageIds, "uuid")}) OR l.to_page_id = ANY(${pgArray(pageIds, "uuid")}))`
    : sql``;
  const rows = (await pgDb.execute(sql`
    SELECT l.id, l.from_page_id AS "fromPageId", l.to_page_id AS "toPageId",
           l.link_type AS "linkType", l.confidence::float AS confidence, l.context
    FROM project_brain_link l
    WHERE l.project_id = ${projectId}
      ${scoped}
      AND EXISTS (
        SELECT 1 FROM project_brain_link_evidence e
        WHERE e.link_id = l.id AND e.status = 'current'
      )
    LIMIT ${MAX_LINKS_PER_PROJECT}
  `)) as unknown as Array<
    Omit<GraphLinkRow, "linkType"> & { linkType: string }
  >;

  return rows.map((row) => ({
    ...row,
    confidence: Number(row.confidence),
    linkType: isProjectEdgeType(row.linkType)
      ? row.linkType
      : ("related_to" as const),
  }));
}

/** Resolve a free-text name to the best matching page (alias, then title). */
export async function resolvePageByName(input: {
  projectId: string;
  name: string;
  type?: string;
}): Promise<GraphPage | null> {
  const needle = input.name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return null;

  const rows = (await pgDb.execute(sql`
    SELECT p.id, p.type, p.title, p.summary, p.salience::float AS salience,
           GREATEST(
             similarity(a.normalized_alias, ${needle}),
             similarity(lower(p.title), ${needle})
           ) AS score
    FROM project_brain_page p
    LEFT JOIN project_brain_alias a ON a.page_id = p.id
    WHERE p.project_id = ${input.projectId}
      AND p.archived_at IS NULL
      ${input.type ? sql`AND p.type = ${input.type}` : sql``}
      AND (
        a.normalized_alias = ${needle}
        OR lower(p.title) = ${needle}
        OR similarity(a.normalized_alias, ${needle}) > 0.35
        OR similarity(lower(p.title), ${needle}) > 0.35
      )
    ORDER BY score DESC, p.salience DESC
    LIMIT 1
  `)) as unknown as Array<GraphPage & { score: number }>;

  const row = rows[0];
  return row
    ? {
        id: row.id,
        type: row.type,
        title: row.title,
        summary: row.summary,
        salience: Number(row.salience),
      }
    : null;
}

export type EntityDetail = {
  page: GraphPage;
  aliases: string[];
  mergedFrom: string[];
  facts: Array<{ key: string; value: string; confidence: number }>;
  links: Array<{ type: ProjectEdgeType; page: GraphPage; confidence: number }>;
  backlinks: Array<{
    type: ProjectEdgeType;
    page: GraphPage;
    confidence: number;
  }>;
};

export async function getEntity(input: {
  projectId: string;
  pageId?: string;
  name?: string;
}): Promise<EntityDetail | null> {
  let page: GraphPage | null = null;
  if (input.pageId) {
    [page = null] = await loadPages(input.projectId, [input.pageId]);
  } else if (input.name) {
    page = await resolvePageByName({
      projectId: input.projectId,
      name: input.name,
    });
  }
  if (!page) return null;

  const [aliases, merged, facts, links] = await Promise.all([
    pgDb
      .select({ alias: ProjectBrainAliasTable.alias })
      .from(ProjectBrainAliasTable)
      .where(eq(ProjectBrainAliasTable.pageId, page.id)),
    pgDb
      .select({ title: ProjectBrainPageTable.title })
      .from(ProjectBrainPageTable)
      .where(eq(ProjectBrainPageTable.mergedIntoPageId, page.id)),
    pgDb
      .select({
        key: ProjectBrainFactTable.factKey,
        value: ProjectBrainFactTable.value,
        confidence: ProjectBrainFactTable.confidence,
      })
      .from(ProjectBrainFactTable)
      .where(
        and(
          eq(ProjectBrainFactTable.pageId, page.id),
          eq(ProjectBrainFactTable.status, "current"),
        ),
      )
      .orderBy(desc(ProjectBrainFactTable.lastObservedAt))
      .limit(40),
    loadCurrentLinks(input.projectId, [page.id]),
  ]);

  const neighbourIds = [
    ...new Set(
      links.map((link) =>
        link.fromPageId === page.id ? link.toPageId : link.fromPageId,
      ),
    ),
  ];
  const neighbours = new Map(
    (await loadPages(input.projectId, neighbourIds)).map((row) => [
      row.id,
      row,
    ]),
  );

  const outgoing: EntityDetail["links"] = [];
  const incoming: EntityDetail["backlinks"] = [];
  for (const link of links) {
    const isOut = link.fromPageId === page.id;
    const other = neighbours.get(isOut ? link.toPageId : link.fromPageId);
    if (!other) continue;
    (isOut ? outgoing : incoming).push({
      type: link.linkType,
      page: other,
      confidence: link.confidence,
    });
  }

  return {
    page,
    aliases: [...new Set(aliases.map((row) => row.alias))].filter(
      (alias) => alias !== page.title,
    ),
    mergedFrom: merged.map((row) => row.title),
    facts: facts.map((fact) => ({
      ...fact,
      confidence: Number(fact.confidence),
    })),
    links: outgoing,
    backlinks: incoming,
  };
}

export type Subgraph = {
  nodes: Array<GraphPage & { depth: number }>;
  edges: GraphLinkRow[];
};

/** Bounded multi-hop traversal (recursive CTE) from one or more pages. */
export async function traverse(input: {
  projectId: string;
  startPageIds: string[];
  depth?: number;
  edgeTypes?: ProjectEdgeType[];
  limit?: number;
}): Promise<Subgraph> {
  const depth = Math.max(0, Math.min(input.depth ?? 2, 3));
  const limit = Math.max(1, Math.min(input.limit ?? 200, 400));
  if (!input.startPageIds.length) return { nodes: [], edges: [] };

  const typeFilter = input.edgeTypes?.length
    ? sql`AND l.link_type = ANY(${pgArray(input.edgeTypes, "text")})`
    : sql``;

  const reached = (await pgDb.execute(sql`
    WITH RECURSIVE walk AS (
      SELECT p.id AS page_id, 0 AS depth
      FROM project_brain_page p
      WHERE p.project_id = ${input.projectId}
        AND p.id = ANY(${pgArray(input.startPageIds, "uuid")})
        AND p.archived_at IS NULL
      UNION
      SELECT CASE WHEN l.from_page_id = w.page_id THEN l.to_page_id ELSE l.from_page_id END,
             w.depth + 1
      FROM walk w
      JOIN project_brain_link l
        ON l.project_id = ${input.projectId}
       AND (l.from_page_id = w.page_id OR l.to_page_id = w.page_id)
      WHERE w.depth < ${depth}
        ${typeFilter}
        AND EXISTS (
          SELECT 1 FROM project_brain_link_evidence e
          WHERE e.link_id = l.id AND e.status = 'current'
        )
    )
    SELECT page_id AS "pageId", MIN(depth) AS depth
    FROM walk
    GROUP BY page_id
    ORDER BY MIN(depth), page_id
    LIMIT ${limit}
  `)) as unknown as Array<{ pageId: string; depth: number }>;

  const depthById = new Map(
    reached.map((row) => [row.pageId, Number(row.depth)]),
  );
  const pages = await loadPages(input.projectId, [...depthById.keys()]);
  const ids = new Set(pages.map((page) => page.id));
  const edges = (await loadCurrentLinks(input.projectId, [...ids])).filter(
    (link) =>
      ids.has(link.fromPageId) &&
      ids.has(link.toPageId) &&
      (!input.edgeTypes?.length || input.edgeTypes.includes(link.linkType)),
  );

  return {
    nodes: pages
      .map((page) => ({ ...page, depth: depthById.get(page.id) ?? 0 }))
      .sort((a, b) => a.depth - b.depth || b.salience - a.salience),
    edges,
  };
}

/** Shortest undirected path between two pages (BFS over current links). */
export async function findPath(input: {
  projectId: string;
  fromPageId: string;
  toPageId: string;
  maxDepth?: number;
}): Promise<{ nodes: GraphPage[]; edges: GraphLinkRow[] } | null> {
  if (input.fromPageId === input.toPageId) {
    const [page] = await loadPages(input.projectId, [input.fromPageId]);
    return page ? { nodes: [page], edges: [] } : null;
  }

  const maxDepth = Math.max(1, Math.min(input.maxDepth ?? 4, 6));
  const links = await loadCurrentLinks(input.projectId);
  const adjacency = new Map<string, GraphLinkRow[]>();
  for (const link of links) {
    for (const id of [link.fromPageId, link.toPageId]) {
      const list = adjacency.get(id) ?? [];
      list.push(link);
      adjacency.set(id, list);
    }
  }

  const previous = new Map<string, { via: GraphLinkRow; from: string }>();
  const visited = new Set([input.fromPageId]);
  let frontier = [input.fromPageId];
  for (let step = 0; step < maxDepth && frontier.length; step++) {
    const next: string[] = [];
    for (const current of frontier) {
      for (const link of adjacency.get(current) ?? []) {
        const other =
          link.fromPageId === current ? link.toPageId : link.fromPageId;
        if (visited.has(other)) continue;
        visited.add(other);
        previous.set(other, { via: link, from: current });
        if (other === input.toPageId) {
          const pathEdges: GraphLinkRow[] = [];
          const pathIds = [other];
          let cursor = other;
          while (cursor !== input.fromPageId) {
            const hop = previous.get(cursor);
            if (!hop) break;
            pathEdges.unshift(hop.via);
            pathIds.unshift(hop.from);
            cursor = hop.from;
          }
          const pages = await loadPages(input.projectId, pathIds);
          const byId = new Map(pages.map((page) => [page.id, page]));
          const ordered = pathIds
            .map((id) => byId.get(id))
            .filter((page): page is GraphPage => Boolean(page));
          return ordered.length === pathIds.length
            ? { nodes: ordered, edges: pathEdges }
            : null;
        }
        next.push(other);
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * "Who knows about X": people ranked by how many current links connect them
 * to pages whose alias or title matches the query terms, salience as
 * tie-break. Pure ranking is exported for tests.
 */
export function rankWhoKnows(input: {
  people: GraphPage[];
  targetIds: Set<string>;
  links: GraphLinkRow[];
}) {
  const score = new Map<string, number>();
  for (const link of input.links) {
    const pairs: Array<[string, string]> = [
      [link.fromPageId, link.toPageId],
      [link.toPageId, link.fromPageId],
    ];
    for (const [person, target] of pairs) {
      if (!input.targetIds.has(target)) continue;
      score.set(person, (score.get(person) ?? 0) + link.confidence);
    }
  }
  return input.people
    .map((person) => ({ person, score: score.get(person.id) ?? 0 }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.person.salience - a.person.salience);
}

export async function whoKnows(input: {
  projectId: string;
  query: string;
  limit?: number;
}) {
  const terms = input.query
    .split(/\s+/)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3)
    .slice(0, 6);
  if (!terms.length) return [];

  const targets = await pgDb
    .selectDistinct({ pageId: ProjectBrainAliasTable.pageId })
    .from(ProjectBrainAliasTable)
    .innerJoin(
      ProjectBrainPageTable,
      eq(ProjectBrainPageTable.id, ProjectBrainAliasTable.pageId),
    )
    .where(
      and(
        eq(ProjectBrainAliasTable.projectId, input.projectId),
        isNull(ProjectBrainPageTable.archivedAt),
        or(
          ...terms.map((term) =>
            ilike(ProjectBrainAliasTable.normalizedAlias, `%${term}%`),
          ),
        ),
      ),
    )
    .limit(50);
  const targetIds = new Set(targets.map((row) => row.pageId));
  if (!targetIds.size) return [];

  const links = await loadCurrentLinks(input.projectId, [...targetIds]);
  const personIds = [
    ...new Set(links.flatMap((link) => [link.fromPageId, link.toPageId])),
  ];
  const people = (await loadPages(input.projectId, personIds)).filter(
    (page) => page.type === "person",
  );

  return rankWhoKnows({ people, targetIds, links })
    .slice(0, input.limit ?? 5)
    .map((row) => ({ ...row.person, score: Number(row.score.toFixed(2)) }));
}
