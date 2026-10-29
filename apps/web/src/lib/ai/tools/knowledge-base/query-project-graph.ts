import { PROJECT_EDGE_TYPES } from "@/lib/project-brain/edge-types";
import { tool as createTool } from "ai";
import { z } from "zod";

const EdgeTypeSchema = z.enum(PROJECT_EDGE_TYPES);

export const queryProjectGraphSchema = z.object({
  operation: z
    .enum(["entity", "neighbors", "path", "whoknows"])
    .describe(
      "entity: facts, links and backlinks of one page. neighbors: pages within N hops. path: how two pages connect. whoknows: people most connected to a topic.",
    ),
  name: z
    .string()
    .max(160)
    .optional()
    .describe(
      "Name of the person, organization, meeting, task or topic (entity, neighbors, path).",
    ),
  otherName: z.string().max(160).optional().describe("Second name for `path`."),
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Topic words for `whoknows`, e.g. 'moebel.de sync' or 'KMD filing'.",
    ),
  depth: z
    .number()
    .int()
    .min(1)
    .max(3)
    .optional()
    .describe("Hops for `neighbors` (default 1)."),
  edgeTypes: z
    .array(EdgeTypeSchema)
    .max(6)
    .optional()
    .describe("Restrict `neighbors` to these relation types."),
});

type Params = z.infer<typeof queryProjectGraphSchema>;

function refLine(kind: string, label: string) {
  return `${label} (${kind})`;
}

/**
 * Chat tool over the project knowledge graph. Bound to the project of the
 * current thread, so the model never has to know page ids: every operation
 * takes names and resolves them through aliases.
 */
export const createQueryProjectGraphTool = (
  userId: string,
  projectId?: string,
) =>
  createTool({
    description:
      "Query the project's knowledge graph: who is connected to what, which " +
      "people, organizations, meetings, tasks and decisions relate to each " +
      "other, who knows about a topic, and how two things are linked. Use it " +
      "for questions about relationships and people ('who organizes X', " +
      "'how is A connected to B', 'who should I ask about Y'). For document " +
      "text use searchKnowledgeBase instead.",
    inputSchema: queryProjectGraphSchema,
    execute: async (params: Params) => {
      if (!projectId) {
        return {
          success: false,
          message: "This chat is not attached to a project.",
        };
      }
      if (!userId) {
        return { success: false, message: "User context missing." };
      }

      const { requireProjectAccess } = await import("@/lib/projects/access");
      const { getEntity, findPath, resolvePageByName, traverse, whoKnows } =
        await import("@/lib/project-brain/graph-query");

      try {
        await requireProjectAccess({ projectId, userId });
      } catch {
        return { success: false, message: "No access to this project." };
      }

      switch (params.operation) {
        case "entity": {
          if (!params.name) {
            return { success: false, message: "`name` is required." };
          }
          const entity = await getEntity({ projectId, name: params.name });
          if (!entity) {
            return {
              success: false,
              message: `No page named "${params.name}" in this project.`,
            };
          }
          const lines = [
            `${entity.page.title} (${entity.page.type})`,
            entity.page.summary ? `Summary: ${entity.page.summary}` : null,
            entity.aliases.length
              ? `Also known as: ${entity.aliases.join(", ")}`
              : null,
            entity.facts.length
              ? `Facts:\n${entity.facts
                  .slice(0, 20)
                  .map((fact) => `- ${fact.key}: ${fact.value}`)
                  .join("\n")}`
              : "Facts: none recorded.",
            entity.links.length
              ? `Links:\n${entity.links
                  .map(
                    (link) =>
                      `- ${entity.page.title} —${link.type}→ ${refLine(link.page.type, link.page.title)}`,
                  )
                  .join("\n")}`
              : null,
            entity.backlinks.length
              ? `Backlinks:\n${entity.backlinks
                  .map(
                    (link) =>
                      `- ${refLine(link.page.type, link.page.title)} —${link.type}→ ${entity.page.title}`,
                  )
                  .join("\n")}`
              : null,
          ].filter(Boolean);
          return {
            success: true,
            text: lines.join("\n"),
            pageId: entity.page.id,
          };
        }

        case "neighbors": {
          if (!params.name) {
            return { success: false, message: "`name` is required." };
          }
          const start = await resolvePageByName({
            projectId,
            name: params.name,
          });
          if (!start) {
            return {
              success: false,
              message: `No page named "${params.name}" in this project.`,
            };
          }
          const subgraph = await traverse({
            projectId,
            startPageIds: [start.id],
            depth: params.depth ?? 1,
            edgeTypes: params.edgeTypes,
            limit: 60,
          });
          const byId = new Map(subgraph.nodes.map((node) => [node.id, node]));
          const edgeLines = subgraph.edges.slice(0, 60).map((edge) => {
            const from = byId.get(edge.fromPageId);
            const to = byId.get(edge.toPageId);
            return `- ${from?.title ?? "?"} —${edge.linkType}→ ${to?.title ?? "?"}`;
          });
          return {
            success: true,
            text: [
              `Neighbourhood of ${start.title} (${subgraph.nodes.length} pages, ${subgraph.edges.length} links):`,
              ...subgraph.nodes
                .filter((node) => node.id !== start.id)
                .slice(0, 40)
                .map(
                  (node) =>
                    `- ${refLine(node.type, node.title)}${node.depth > 1 ? ` [${node.depth} hops]` : ""}`,
                ),
              edgeLines.length ? "Relations:" : "",
              ...edgeLines,
            ]
              .filter(Boolean)
              .join("\n"),
          };
        }

        case "path": {
          if (!params.name || !params.otherName) {
            return {
              success: false,
              message: "`name` and `otherName` are required.",
            };
          }
          const [from, to] = await Promise.all([
            resolvePageByName({ projectId, name: params.name }),
            resolvePageByName({ projectId, name: params.otherName }),
          ]);
          if (!from || !to) {
            return {
              success: false,
              message: `Could not resolve ${!from ? params.name : params.otherName}.`,
            };
          }
          const path = await findPath({
            projectId,
            fromPageId: from.id,
            toPageId: to.id,
          });
          if (!path) {
            return {
              success: true,
              text: `No known connection between ${from.title} and ${to.title} within 4 hops.`,
            };
          }
          const steps = path.edges.map((edge, index) => {
            const a = path.nodes[index];
            const b = path.nodes[index + 1];
            const forward = edge.fromPageId === a.id;
            return `${a.title} ${forward ? "—" : "←"}${edge.linkType}${forward ? "→" : "—"} ${b.title}`;
          });
          return {
            success: true,
            text: steps.length
              ? `Path (${steps.length} hops):\n${steps.map((step) => `- ${step}`).join("\n")}`
              : `${from.title} and ${to.title} are the same page.`,
          };
        }

        case "whoknows": {
          if (!params.query) {
            return { success: false, message: "`query` is required." };
          }
          const people = await whoKnows({ projectId, query: params.query });
          if (!people.length) {
            return {
              success: true,
              text: `Nobody in the graph is linked to "${params.query}" yet.`,
            };
          }
          return {
            success: true,
            text: [
              `People connected to "${params.query}":`,
              ...people.map(
                (person) =>
                  `- ${person.title}${person.summary ? ` — ${person.summary}` : ""} (score ${person.score})`,
              ),
            ].join("\n"),
          };
        }
      }
    },
  });
