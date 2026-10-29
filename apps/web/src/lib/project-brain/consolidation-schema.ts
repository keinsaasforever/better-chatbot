import { z } from "zod";
import { resilientArray } from "./extraction-schema";

const KeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_ -]*$/i);

export const ConsolidatedTodoSchema = z.object({
  key: KeySchema,
  title: z.string().trim().min(1).max(160),
  detail: z.string().max(500).optional(),
  priority: z.enum(["low", "normal", "high", "critical"]).catch("normal"),
  dueAt: z.string().datetime().optional(),
  sourceScope: z.string().max(120).optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  notify: z.boolean().default(false),
});

/**
 * What the project-level consolidation model returns: one status and one list
 * of to-dos for the whole project, judged against the project's goal.
 */
export const ConsolidationSchema = z.object({
  health: z.enum(["green", "yellow", "red", "unknown"]).catch("unknown"),
  progressPct: z.number().min(0).max(100).optional(),
  summary: z.string().trim().max(600).default(""),
  blockers: z.array(z.string().trim().min(1).max(300)).max(8).default([]),
  todos: z.preprocess(
    resilientArray(ConsolidatedTodoSchema),
    z.array(ConsolidatedTodoSchema).max(40).default([]),
  ),
  /** Keys of existing to-dos the sources show as finished. */
  resolvedKeys: z.array(KeySchema).max(60).default([]),
});

export type ConsolidationProposal = z.infer<typeof ConsolidationSchema>;
