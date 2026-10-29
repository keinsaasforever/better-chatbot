import "server-only";

import { customModelProvider, projectBrainModelId } from "@/lib/ai/models";
import { generateObjectResilient } from "@/lib/ai/resilient-object";
import { pgDb } from "@/lib/db/pg/db.pg";
import {
  ProjectBrainContradictionTable,
  ProjectBrainPageTable,
  type ProjectBrainSourceSignalsRecord,
  ProjectConnectedToolTable,
  ProjectStatusSnapshotTable,
  ProjectTable,
  ProjectTodoTable,
} from "@/lib/db/pg/schema.pg";
import { createNotifications } from "@/lib/notifications/create-notifications";
import { listProjectRecipientUserIds } from "@/lib/projects/recipients";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type ConsolidationProposal,
  ConsolidationSchema,
} from "./consolidation-schema";
import { loadCurrentLinks } from "./graph-query";
import { mergeTodos, normalizeTodoKey } from "./merge-todos";
import { buildConsolidationSystemPrompt } from "./prompts";

/** Caps that keep one consolidation call around 20-25k tokens. */
const MAX_SOURCES = 12;
const MAX_SUMMARY_CHARS = 1200;
const MAX_SOURCE_TODOS = 15;
const MAX_OPEN_TODOS = 60;
const MAX_CLOSED_KEYS = 100;
const CLOSED_KEYS_WINDOW_DAYS = 30;
const SNAPSHOT_TODO_ITEMS = 10;

type Health = "green" | "yellow" | "red" | "unknown";

export type HealthTransition = { from: Health; to: Health };

export type ConsolidationApplyResult = {
  snapshotId: string | null;
  notifyTodos: Array<{ id: string; title: string; priority: string }>;
  healthTransition: HealthTransition | null;
  counts: { inserted: number; updated: number; closed: number };
};

type SourceSignalRow = {
  id: string;
  source_scope: string;
  source_type: string;
  title: string | null;
  observed_at: string | Date;
  extraction_signals: ProjectBrainSourceSignalsRecord | null;
};

async function loadSourceLabels(projectId: string) {
  const connectors = await pgDb
    .select({
      id: ProjectConnectedToolTable.id,
      displayName: ProjectConnectedToolTable.displayName,
    })
    .from(ProjectConnectedToolTable)
    .where(eq(ProjectConnectedToolTable.projectId, projectId));

  return new Map(
    connectors.map((connector) => [
      `tool:${connector.id}`,
      connector.displayName,
    ]),
  );
}

function labelForScope(
  scope: string | null | undefined,
  labels: Map<string, string>,
  fallback?: string | null,
) {
  if (!scope) return fallback ?? null;
  return labels.get(scope) ?? fallback ?? scope.split(":")[0] ?? null;
}

const MAX_GRAPH_PAGES = 15;
const MAX_GRAPH_EDGES = 40;

async function loadGraphContext(projectId: string) {
  const pages = await pgDb
    .select({
      id: ProjectBrainPageTable.id,
      type: ProjectBrainPageTable.type,
      title: ProjectBrainPageTable.title,
      summary: ProjectBrainPageTable.summary,
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
    .limit(MAX_GRAPH_PAGES);
  if (!pages.length) return { entities: [], relations: [] };

  const title = new Map(pages.map((page) => [page.id, page.title]));
  const links = (
    await loadCurrentLinks(
      projectId,
      pages.map((page) => page.id),
    )
  )
    .filter(
      (link) =>
        title.has(link.fromPageId) &&
        title.has(link.toPageId) &&
        link.linkType !== "mentions",
    )
    .slice(0, MAX_GRAPH_EDGES);

  return {
    entities: pages.map((page) => ({
      type: page.type,
      title: page.title,
      summary: (page.summary ?? "").slice(0, 200),
    })),
    relations: links.map(
      (link) =>
        `${title.get(link.fromPageId)} -${link.linkType}-> ${title.get(link.toPageId)}`,
    ),
  };
}

export async function loadConsolidationInput(projectId: string, runId: string) {
  const [project] = await pgDb
    .select({
      name: ProjectTable.name,
      goal: ProjectTable.goal,
      description: ProjectTable.description,
      systemPrompt: ProjectTable.systemPrompt,
    })
    .from(ProjectTable)
    .where(eq(ProjectTable.id, projectId))
    .limit(1);

  if (!project) throw new Error("Project not found.");

  const labels = await loadSourceLabels(projectId);

  // Latest raw source per scope that carries signals. Signals only: the raw
  // text was already read by the per-source extraction.
  const rows = (await pgDb.execute(sql`
    SELECT id, source_scope, source_type, title, observed_at, extraction_signals
    FROM (
      SELECT DISTINCT ON (source_scope)
        id, source_scope, source_type, title, observed_at, extraction_signals
      FROM project_brain_raw_source
      WHERE project_id = ${projectId}
        AND extraction_signals IS NOT NULL
      ORDER BY source_scope, observed_at DESC
    ) latest
    ORDER BY observed_at DESC
    LIMIT ${MAX_SOURCES}
  `)) as unknown as SourceSignalRow[];

  const sources = rows.map((row) => {
    const signals = row.extraction_signals;
    return {
      sourceScope: row.source_scope,
      sourceType: row.source_type,
      label: labelForScope(row.source_scope, labels, row.title),
      observedAt: new Date(row.observed_at).toISOString(),
      summary: (signals?.summary ?? "").slice(0, MAX_SUMMARY_CHARS),
      status: signals?.status ?? null,
      todos: (signals?.todos ?? []).slice(0, MAX_SOURCE_TODOS),
    };
  });

  const openTodos = await pgDb
    .select({
      key: ProjectTodoTable.key,
      title: ProjectTodoTable.title,
      priority: ProjectTodoTable.priority,
      dueAt: ProjectTodoTable.dueAt,
      sourceScope: ProjectTodoTable.sourceScope,
    })
    .from(ProjectTodoTable)
    .where(
      and(
        eq(ProjectTodoTable.projectId, projectId),
        eq(ProjectTodoTable.status, "open"),
      ),
    )
    .orderBy(desc(ProjectTodoTable.lastSeenAt))
    .limit(MAX_OPEN_TODOS);

  const closed = await pgDb
    .select({ key: ProjectTodoTable.key })
    .from(ProjectTodoTable)
    .where(
      and(
        eq(ProjectTodoTable.projectId, projectId),
        inArray(ProjectTodoTable.status, ["done", "dismissed"]),
        sql`${ProjectTodoTable.resolvedAt} > CURRENT_TIMESTAMP - INTERVAL '${sql.raw(String(CLOSED_KEYS_WINDOW_DAYS))} days'`,
      ),
    )
    .orderBy(desc(ProjectTodoTable.resolvedAt))
    .limit(MAX_CLOSED_KEYS);

  const [previous] = await pgDb
    .select({
      health: ProjectStatusSnapshotTable.health,
      summary: ProjectStatusSnapshotTable.summary,
    })
    .from(ProjectStatusSnapshotTable)
    .where(
      and(
        eq(ProjectStatusSnapshotTable.projectId, projectId),
        sql`${ProjectStatusSnapshotTable.runId} IS DISTINCT FROM ${runId}::uuid`,
      ),
    )
    .orderBy(desc(ProjectStatusSnapshotTable.generatedAt))
    .limit(1);

  // The most salient entities and how they relate, so status and to-dos can
  // name the right people, organizations and meetings.
  const graphContext = await loadGraphContext(projectId);

  return {
    project: {
      name: project.name,
      goal: project.goal ?? "",
      description: project.description ?? "",
      instructions: project.systemPrompt ?? "",
    },
    graphContext,
    sources,
    existingTodos: openTodos.map((todo) => ({
      ...todo,
      dueAt: todo.dueAt ? todo.dueAt.toISOString() : null,
    })),
    closedKeys: closed.map((row) => row.key),
    previousStatus: previous
      ? { health: previous.health, summary: previous.summary ?? "" }
      : null,
  };
}

/**
 * One structured LLM call over the per-source signals. Pure with respect to
 * the database (reads only), so an Inngest replay is harmless.
 */
export async function generateProjectConsolidation(input: {
  projectId: string;
  runId: string;
  timeoutMs?: number;
}): Promise<ConsolidationProposal> {
  const consolidationInput = await loadConsolidationInput(
    input.projectId,
    input.runId,
  );

  const { object } = await generateObjectResilient({
    model: projectBrainModelId,
    fallbackModel: customModelProvider.getModel(),
    label: `project-consolidate:${input.projectId}`,
    schema: ConsolidationSchema,
    abortSignal: input.timeoutMs
      ? AbortSignal.timeout(input.timeoutMs)
      : undefined,
    system: buildConsolidationSystemPrompt(),
    prompt: JSON.stringify(consolidationInput),
  });

  return object;
}

/**
 * Apply a proposal in one transaction. Safe to replay: todos upsert on
 * (project, key), the snapshot is unique per run, and the "to notify" list is
 * re-read by `notified_run_id` so a retried step returns the same rows.
 */
export async function applyProjectConsolidation(input: {
  projectId: string;
  runId: string;
  proposal: ConsolidationProposal;
}): Promise<ConsolidationApplyResult> {
  const { projectId, runId, proposal } = input;
  const labels = await loadSourceLabels(projectId);

  const [project] = await pgDb
    .select({ ownerUserId: ProjectTable.ownerUserId })
    .from(ProjectTable)
    .where(eq(ProjectTable.id, projectId))
    .limit(1);
  if (!project) throw new Error("Project not found.");

  return pgDb.transaction(async (tx) => {
    const now = new Date();

    const existing = await tx
      .select({
        id: ProjectTodoTable.id,
        key: ProjectTodoTable.key,
        status: ProjectTodoTable.status,
        notifiedAt: ProjectTodoTable.notifiedAt,
      })
      .from(ProjectTodoTable)
      .where(eq(ProjectTodoTable.projectId, projectId));

    const merge = mergeTodos(
      existing,
      proposal.todos.map((todo) => ({
        key: todo.key,
        title: todo.title,
        detail: todo.detail ?? null,
        priority: todo.priority,
        dueAt: todo.dueAt ?? null,
        sourceScope: todo.sourceScope ?? null,
        sourceLabel: labelForScope(todo.sourceScope, labels),
        sourceUrl: todo.sourceUrl ?? null,
        notify: todo.notify,
      })),
      proposal.resolvedKeys,
    );

    if (merge.insert.length) {
      await tx
        .insert(ProjectTodoTable)
        .values(
          merge.insert.map((todo) => ({
            projectId,
            key: todo.key,
            title: todo.title,
            detail: todo.detail ?? null,
            priority: todo.priority,
            dueAt: todo.dueAt ? new Date(todo.dueAt) : null,
            sourceScope: todo.sourceScope ?? null,
            sourceLabel: todo.sourceLabel ?? null,
            sourceUrl: todo.sourceUrl ?? null,
            status: "open" as const,
            lastSeenAt: now,
          })),
        )
        // A replayed step re-inserts keys that now exist; refresh open rows,
        // leave user-closed rows alone.
        .onConflictDoUpdate({
          target: [ProjectTodoTable.projectId, ProjectTodoTable.key],
          set: {
            title: sql`excluded.title`,
            detail: sql`excluded.detail`,
            priority: sql`excluded.priority`,
            dueAt: sql`excluded.due_at`,
            sourceScope: sql`excluded.source_scope`,
            sourceLabel: sql`excluded.source_label`,
            sourceUrl: sql`excluded.source_url`,
            lastSeenAt: now,
            updatedAt: now,
          },
          setWhere: eq(ProjectTodoTable.status, "open"),
        });
    }

    for (const todo of merge.update) {
      await tx
        .update(ProjectTodoTable)
        .set({
          title: todo.title,
          detail: todo.detail ?? null,
          priority: todo.priority,
          dueAt: todo.dueAt ? new Date(todo.dueAt) : null,
          sourceScope: todo.sourceScope ?? null,
          sourceLabel: todo.sourceLabel ?? null,
          sourceUrl: todo.sourceUrl ?? null,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(ProjectTodoTable.id, todo.id),
            eq(ProjectTodoTable.status, "open"),
          ),
        );
    }

    if (merge.close.length) {
      await tx
        .update(ProjectTodoTable)
        .set({
          status: "done",
          resolvedAt: now,
          resolvedByUserId: null,
          updatedAt: now,
        })
        .where(
          and(
            inArray(ProjectTodoTable.id, merge.close),
            eq(ProjectTodoTable.status, "open"),
          ),
        );
    }

    if (merge.notifyKeys.length) {
      await tx
        .update(ProjectTodoTable)
        .set({
          notifiedAt: sql`COALESCE(${ProjectTodoTable.notifiedAt}, CURRENT_TIMESTAMP)`,
          notifiedRunId: runId,
          updatedAt: now,
        })
        .where(
          and(
            eq(ProjectTodoTable.projectId, projectId),
            inArray(ProjectTodoTable.key, merge.notifyKeys),
            eq(ProjectTodoTable.status, "open"),
          ),
        );
    }

    const notifyTodos = await tx
      .select({
        id: ProjectTodoTable.id,
        title: ProjectTodoTable.title,
        priority: ProjectTodoTable.priority,
      })
      .from(ProjectTodoTable)
      .where(
        and(
          eq(ProjectTodoTable.projectId, projectId),
          eq(ProjectTodoTable.notifiedRunId, runId),
        ),
      );

    const openAfter = await tx
      .select({
        title: ProjectTodoTable.title,
        priority: ProjectTodoTable.priority,
      })
      .from(ProjectTodoTable)
      .where(
        and(
          eq(ProjectTodoTable.projectId, projectId),
          eq(ProjectTodoTable.status, "open"),
        ),
      )
      .orderBy(desc(ProjectTodoTable.lastSeenAt))
      .limit(SNAPSHOT_TODO_ITEMS);

    const [previous] = await tx
      .select({ health: ProjectStatusSnapshotTable.health })
      .from(ProjectStatusSnapshotTable)
      .where(
        and(
          eq(ProjectStatusSnapshotTable.projectId, projectId),
          sql`${ProjectStatusSnapshotTable.runId} IS DISTINCT FROM ${runId}::uuid`,
        ),
      )
      .orderBy(desc(ProjectStatusSnapshotTable.generatedAt))
      .limit(1);

    // Open contradictions the dream cycle found are blockers a member should
    // clear, listed after the model's own blockers.
    const conflicts = await tx
      .select({
        pageTitle: ProjectBrainPageTable.title,
        factKey: ProjectBrainContradictionTable.factKey,
      })
      .from(ProjectBrainContradictionTable)
      .innerJoin(
        ProjectBrainPageTable,
        eq(ProjectBrainPageTable.id, ProjectBrainContradictionTable.pageId),
      )
      .where(
        and(
          eq(ProjectBrainContradictionTable.projectId, projectId),
          eq(ProjectBrainContradictionTable.status, "open"),
          eq(ProjectBrainContradictionTable.verdict, "contradiction"),
        ),
      )
      .orderBy(desc(ProjectBrainContradictionTable.createdAt))
      .limit(3);
    const blockers = [
      ...proposal.blockers,
      ...conflicts.map(
        (row) => `Conflicting information: ${row.pageTitle} (${row.factKey})`,
      ),
    ].slice(0, 8);

    const generatedAt = now.toISOString();
    const [inserted] = await tx
      .insert(ProjectStatusSnapshotTable)
      .values({
        projectId,
        userId: project.ownerUserId,
        runId,
        todosRenderData: {
          items: openAfter.map((todo) => ({
            title: todo.title,
            status: "open",
            priority: todo.priority,
          })),
          generatedAt,
        },
        statusRenderData: {
          health: proposal.health,
          progressPct: proposal.progressPct ?? null,
          summary: proposal.summary,
          blockers,
          generatedAt,
        },
        summary: proposal.summary,
        health: proposal.health,
        generatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: ProjectStatusSnapshotTable.id });

    const healthTransition: HealthTransition | null =
      previous &&
      proposal.health !== "unknown" &&
      previous.health !== proposal.health
        ? { from: previous.health, to: proposal.health }
        : null;

    return {
      snapshotId: inserted?.id ?? null,
      notifyTodos,
      healthTransition,
      counts: {
        inserted: merge.insert.length,
        updated: merge.update.length,
        closed: merge.close.length,
      },
    };
  });
}

const HEALTH_LABEL: Record<Health, string> = {
  green: "on track",
  yellow: "at risk",
  red: "off track",
  unknown: "unknown",
};

/** Build the digest copy. Exported for tests. */
export function buildProjectDigest(input: {
  projectName: string;
  notifyTodos: Array<{ title: string }>;
  healthTransition: HealthTransition | null;
}): { title: string; body: string } | null {
  const { projectName, notifyTodos, healthTransition } = input;
  if (!notifyTodos.length && !healthTransition) return null;

  const parts: string[] = [];
  if (notifyTodos.length) {
    parts.push(
      `${notifyTodos.length} new to-do${notifyTodos.length === 1 ? "" : "s"}`,
    );
  }
  if (healthTransition) {
    parts.push(`now ${HEALTH_LABEL[healthTransition.to]}`);
  }

  const bodyLines = notifyTodos.slice(0, 3).map((todo) => `• ${todo.title}`);
  if (notifyTodos.length > 3) {
    bodyLines.push(`… and ${notifyTodos.length - 3} more`);
  }
  if (healthTransition) {
    bodyLines.push(
      `Status changed from ${HEALTH_LABEL[healthTransition.from]} to ${HEALTH_LABEL[healthTransition.to]}.`,
    );
  }

  return {
    title: `${projectName}: ${parts.join(", ")}`,
    body: bodyLines.join("\n"),
  };
}

/**
 * One digest per run per recipient. `dedupeKey` makes a replayed step a no-op
 * and push goes only to rows that were actually inserted.
 */
export async function notifyProjectConsolidation(input: {
  projectId: string;
  runId: string;
  notifyTodos: Array<{ id: string; title: string; priority: string }>;
  healthTransition: HealthTransition | null;
}): Promise<{ inserted: number }> {
  const [project] = await pgDb
    .select({ name: ProjectTable.name })
    .from(ProjectTable)
    .where(eq(ProjectTable.id, input.projectId))
    .limit(1);
  if (!project) return { inserted: 0 };

  const digest = buildProjectDigest({
    projectName: project.name,
    notifyTodos: input.notifyTodos,
    healthTransition: input.healthTransition,
  });
  if (!digest) return { inserted: 0 };

  const userIds = await listProjectRecipientUserIds(input.projectId);
  const { inserted } = await createNotifications({
    userIds,
    type: "project_digest",
    title: digest.title,
    body: digest.body,
    url: `/projects/${input.projectId}`,
    dedupeKey: `project-digest:${input.runId}`,
    push: {
      kind: input.healthTransition?.to === "red" ? "error" : "complete",
      tag: `project-${input.projectId}`,
    },
  });

  return { inserted: inserted.length };
}

export { normalizeTodoKey };
