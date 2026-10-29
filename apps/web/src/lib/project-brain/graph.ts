import "server-only";

import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainFactTable,
  ProjectBrainPageTable,
  ProjectBrainRawSourceTable,
  ProjectTable,
} from "@/lib/db/pg/schema.pg";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { getEntity, loadCurrentLinks, traverse } from "./graph-query";

export type ProjectGraphNodeKind =
  | "project"
  | "person"
  | "organization"
  | "document"
  | "meeting"
  | "tool"
  | "decision"
  | "topic"
  | "task"
  | "agent"
  | "voice";

const KIND_BY_PAGE_TYPE: Record<string, ProjectGraphNodeKind> = {
  overview: "project",
  person: "person",
  organization: "organization",
  document: "document",
  source: "document",
  meeting: "meeting",
  tool: "tool",
  decision: "decision",
  concept: "topic",
  course: "topic",
  note: "topic",
  topic: "topic",
  task: "task",
  agent: "agent",
  voice: "voice",
};

const MAX_NODES = 150;

export function kindForPageType(type: string): ProjectGraphNodeKind {
  return KIND_BY_PAGE_TYPE[type] ?? "topic";
}

/**
 * The graph the Graph tab renders. Positions are computed client-side (force
 * layout); the server returns nodes ordered by salience, the edges with
 * current evidence between them, and virtual hub edges for orphan nodes so
 * the picture stays connected. `focus` narrows the graph to the
 * neighbourhood of one page.
 */
export async function getProjectKnowledgeGraph(
  projectId: string,
  options: { focus?: string | null; depth?: number } = {},
) {
  const [project] = await pgDb
    .select({
      id: ProjectTable.id,
      name: ProjectTable.name,
      updatedAt: ProjectTable.updatedAt,
    })
    .from(ProjectTable)
    .where(eq(ProjectTable.id, projectId))
    .limit(1);

  if (!project) throw new Error("Project not found.");

  let pages: Array<{
    id: string;
    type: string;
    title: string;
    summary: string | null;
    salience: number;
  }>;
  let truncated = false;

  if (options.focus) {
    const subgraph = await traverse({
      projectId,
      startPageIds: [options.focus],
      depth: options.depth ?? 2,
      limit: MAX_NODES,
    });
    pages = subgraph.nodes;
    truncated = subgraph.nodes.length >= MAX_NODES;
  } else {
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
          isNull(ProjectBrainPageTable.archivedAt),
        ),
      )
      .orderBy(
        desc(ProjectBrainPageTable.salience),
        desc(ProjectBrainPageTable.updatedAt),
      )
      .limit(MAX_NODES + 1);
    truncated = rows.length > MAX_NODES;
    pages = rows.slice(0, MAX_NODES).map((row) => ({
      ...row,
      salience: Number(row.salience),
    }));
  }

  const pageIds = pages.map((page) => page.id);
  const idSet = new Set(pageIds);

  const facts = pageIds.length
    ? await pgDb
        .select({ pageId: ProjectBrainFactTable.pageId })
        .from(ProjectBrainFactTable)
        .where(
          and(
            eq(ProjectBrainFactTable.projectId, projectId),
            eq(ProjectBrainFactTable.status, "current"),
            inArray(ProjectBrainFactTable.pageId, pageIds),
          ),
        )
    : [];
  const factCount = new Map<string, number>();
  for (const fact of facts) {
    factCount.set(fact.pageId, (factCount.get(fact.pageId) ?? 0) + 1);
  }

  const links = pageIds.length
    ? (await loadCurrentLinks(projectId, pageIds)).filter(
        (link) => idSet.has(link.fromPageId) && idSet.has(link.toPageId),
      )
    : [];

  const degree = new Map<string, number>();
  for (const link of links) {
    degree.set(link.fromPageId, (degree.get(link.fromPageId) ?? 0) + 1);
    degree.set(link.toPageId, (degree.get(link.toPageId) ?? 0) + 1);
  }

  const projectNodeId = `project:${project.id}`;
  const nodes = [
    {
      id: projectNodeId,
      kind: "project" as const,
      label: project.name,
      summary: null as string | null,
      factCount: 0,
      salience: 0,
      degree: 0,
    },
    ...pages.map((page) => ({
      id: page.id,
      kind: kindForPageType(page.type),
      label: page.title,
      summary: page.summary,
      factCount: factCount.get(page.id) ?? 0,
      salience: page.salience,
      degree: degree.get(page.id) ?? 0,
    })),
  ];

  const edges = [
    ...links.map((link) => ({
      id: link.id,
      source: link.fromPageId,
      target: link.toPageId,
      kind: link.linkType,
      label: link.linkType.replace(/_/g, " "),
      confidence: link.confidence,
      virtual: false,
    })),
    // Orphans hang off the project hub so the layout stays one component.
    ...pages
      .filter((page) => !degree.has(page.id))
      .map((page) => ({
        id: `hub:${page.id}`,
        source: projectNodeId,
        target: page.id,
        kind: "part_of" as const,
        label: "",
        confidence: 0,
        virtual: true,
      })),
  ];

  return {
    nodes,
    edges,
    total: { nodes: nodes.length, edges: links.length },
    truncated,
    focus: options.focus ?? null,
    availableKinds: [...new Set(nodes.map((node) => node.kind))],
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function getProjectGraphNodeDetail(input: {
  projectId: string;
  nodeId: string;
}) {
  const entity = await getEntity({
    projectId: input.projectId,
    pageId: input.nodeId,
  });
  if (!entity) return null;

  const facts = await pgDb
    .select({
      id: ProjectBrainFactTable.id,
      key: ProjectBrainFactTable.factKey,
      value: ProjectBrainFactTable.value,
      confidence: ProjectBrainFactTable.confidence,
      observedAt: ProjectBrainFactTable.lastObservedAt,
      sourceId: ProjectBrainFactTable.lastSourceId,
    })
    .from(ProjectBrainFactTable)
    .where(
      and(
        eq(ProjectBrainFactTable.pageId, entity.page.id),
        eq(ProjectBrainFactTable.status, "current"),
      ),
    )
    .orderBy(desc(ProjectBrainFactTable.lastObservedAt));

  const sourceIds = [
    ...new Set(facts.flatMap((fact) => (fact.sourceId ? [fact.sourceId] : []))),
  ];
  const sources = sourceIds.length
    ? await pgDb
        .select({
          id: ProjectBrainRawSourceTable.id,
          title: ProjectBrainRawSourceTable.title,
        })
        .from(ProjectBrainRawSourceTable)
        .where(inArray(ProjectBrainRawSourceTable.id, sourceIds))
    : [];
  const sourceName = new Map(
    sources.map((source) => [source.id, source.title]),
  );

  const toRef = (row: (typeof entity.links)[number]) => ({
    type: row.type,
    label: row.type.replace(/_/g, " "),
    confidence: row.confidence,
    page: {
      id: row.page.id,
      kind: kindForPageType(row.page.type),
      label: row.page.title,
    },
  });

  return {
    node: {
      id: entity.page.id,
      kind: kindForPageType(entity.page.type),
      label: entity.page.title,
      summary: entity.page.summary,
      salience: entity.page.salience,
      aliases: entity.aliases,
      mergedFrom: entity.mergedFrom,
    },
    facts: facts.map((fact) => ({
      ...fact,
      confidence: Number(fact.confidence),
      sourceLabel: fact.sourceId
        ? (sourceName.get(fact.sourceId) ?? "Project source")
        : "Project source",
    })),
    links: entity.links.map(toRef),
    backlinks: entity.backlinks.map(toRef),
  };
}
