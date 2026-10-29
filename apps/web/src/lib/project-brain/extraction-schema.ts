import { z } from "zod";
import { normalizeEdgeType } from "./edge-types";

export const ProjectBrainEntityTypeSchema = z.enum([
  "overview",
  "person",
  "organization",
  "course",
  "task",
  "meeting",
  "note",
  "voice",
  "concept",
  "source",
  "decision",
  "document",
  "tool",
  "agent",
  "topic",
]);

const EntityIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);

const FactSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/),
  type: z.enum(["attribute", "status", "decision", "task", "summary"]),
  value: z.string().trim().min(1).max(4000),
  confidence: z.number().min(0).max(1).default(1),
  observedAt: z.string().datetime().optional(),
});

const EntitySchema = z.object({
  id: EntityIdSchema,
  type: ProjectBrainEntityTypeSchema,
  title: z.string().trim().min(1).max(160),
  aliases: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
  summary: z.string().max(2000).optional(),
  facts: z.array(FactSchema).max(100).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

const RelationSchema = z.object({
  fromEntityId: EntityIdSchema,
  toEntityId: EntityIdSchema,
  type: z.string().max(80).transform(normalizeEdgeType),
  context: z.string().max(2000).optional(),
  confidence: z.number().min(0).max(1).default(1),
  observedAt: z.string().datetime().optional(),
});

const TimelineItemSchema = z.object({
  entityId: EntityIdSchema.optional(),
  summary: z.string().min(1),
  detail: z.string().optional(),
  eventDate: z.string().datetime().optional(),
});

const TodoItemSchema = z.object({
  title: z.string().min(1).max(200),
  status: z.enum(["open", "in_progress", "done", "blocked"]).catch("open"),
  priority: z.enum(["low", "normal", "high", "critical"]).catch("normal"),
  rationale: z.string().max(500).optional(),
  detail: z.string().max(500).optional(),
  dueAt: z.string().datetime().optional(),
  sourceUrl: z.string().url().max(2000).optional(),
});

/**
 * Drop array items that do not parse, instead of letting one bad item reject the
 * whole extraction. The model occasionally emits a half-built entity or a todo
 * without a title; losing that item is recoverable, losing the entire run is
 * not.
 *
 * Runs as a `z.preprocess` so the surviving items are still validated by the
 * inner schema afterwards — this filters, it does not weaken.
 */
export function resilientArray(schema: z.ZodTypeAny) {
  return (value: unknown): unknown =>
    Array.isArray(value)
      ? value.filter((item) => schema.safeParse(item).success)
      : value;
}

export const ProjectBrainExtractionSchema = z
  .object({
    summary: z.string().default(""),
    entities: z.preprocess(
      resilientArray(EntitySchema),
      z.array(EntitySchema).max(200).default([]),
    ),
    relations: z.preprocess(
      resilientArray(RelationSchema),
      z.array(RelationSchema).max(500).default([]),
    ),
    timeline: z.preprocess(
      resilientArray(TimelineItemSchema),
      z.array(TimelineItemSchema).default([]),
    ),
    todos: z.preprocess(
      resilientArray(TodoItemSchema),
      z.array(TodoItemSchema).max(40).default([]),
    ),
    status: z
      .object({
        health: z.enum(["green", "yellow", "red", "unknown"]).catch("unknown"),
        progressPct: z.number().min(0).max(100).optional(),
        blockers: z.array(z.string()).default([]),
        shortSummary: z.string().default(""),
      })
      .default({ health: "unknown", blockers: [], shortSummary: "" }),
  })
  .transform((value) => {
    // `persist-extraction.ts` maps entity.id -> pageId with last-write-wins and
    // resolves every relation through that map, so a duplicate id would quietly
    // re-point relations at the wrong page. The previous superRefine rejected
    // the whole extraction for this; keeping the first occurrence protects the
    // graph without throwing the run away.
    const entityIds = new Set<string>();
    const entities = value.entities.filter((entity) => {
      if (entityIds.has(entity.id)) return false;
      entityIds.add(entity.id);
      return true;
    });

    // Dangling and self-referential relations are dropped rather than rejected —
    // a partial extraction beats a total failure on a small cross-reference slip.
    return {
      ...value,
      entities,
      relations: value.relations.filter(
        (relation) =>
          entityIds.has(relation.fromEntityId) &&
          entityIds.has(relation.toEntityId) &&
          relation.fromEntityId !== relation.toEntityId,
      ),
    };
  });

export type ProjectBrainExtraction = z.infer<
  typeof ProjectBrainExtractionSchema
>;

/**
 * The per-source signals the project-level consolidation step reads. They are
 * persisted on the raw source so consolidation never has to re-read raw text.
 */
export type ProjectBrainSourceSignals = Pick<
  ProjectBrainExtraction,
  "summary" | "status" | "todos"
>;
