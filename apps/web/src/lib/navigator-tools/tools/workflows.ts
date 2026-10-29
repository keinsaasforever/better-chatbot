import "server-only";
import { createWorkflowExecutor } from "lib/ai/workflow/executor/workflow-executor";
import { NodeKind } from "lib/ai/workflow/workflow.interface";
import { workflowRepository } from "lib/db/repository";
import { errorToString } from "lib/utils";
import { createWorkflowDraftFromTranscript } from "lib/voice/workflow-draft";
import globalLogger from "logger";
import {
  createWorkflowSpec,
  executeWorkflowSpec,
  generateWorkflowSpec,
  listWorkflowsSpec,
} from "../definitions";
import {
  assertActorCredits,
  assertRolePermission,
  requireOrganization,
  trackActorTokens,
  trim,
} from "../shared";
import { NavigatorToolError, type ToolActor, defineTool } from "../types";

const logger = globalLogger.withDefaults({ message: "Navigator Tools: " });

/** A caller is waiting on `execute_workflow`; longer runs belong in the editor. */
export const EXECUTE_WORKFLOW_TIMEOUT_MS = 60_000;

/** Output returned to a caller; whole results can be megabytes. */
const WORKFLOW_OUTPUT_LIMIT = 4000;

export const listWorkflowsTool = defineTool(
  listWorkflowsSpec,
  async (actor) => {
    const workflows = await workflowRepository.selectAll(
      actor.userId,
      actor.organizationId,
    );
    return {
      workflows: workflows.slice(0, 50).map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        description: trim(workflow.description, 120),
        published: workflow.isPublished,
        isOwner: workflow.userId === actor.userId,
      })),
    };
  },
);

export const createWorkflowTool = defineTool(
  createWorkflowSpec,
  async (actor, args) => {
    await assertRolePermission(
      actor,
      "create",
      "workflow",
      "You don't have permission to create workflows.",
    );
    const workflow = await workflowRepository.save({
      name: args.name,
      description: args.description,
      userId: actor.userId,
      organizationId: actor.organizationId ?? null,
      isPublished: false,
      visibility: "private",
    });
    return {
      created: true,
      workflow: { id: workflow.id, name: workflow.name },
      url: `/workflow/${workflow.id}`,
    };
  },
);

export const generateWorkflowTool = defineTool(
  generateWorkflowSpec,
  async (actor, args) => {
    const organizationId = requireOrganization(actor);
    const billing = await assertActorCredits(actor);
    const draft = await createWorkflowDraftFromTranscript({
      userId: actor.userId,
      orgId: organizationId,
      text: args.description,
    });
    if (!draft) {
      throw new NavigatorToolError(
        "unavailable",
        "The workflow generator is not available in this edition.",
      );
    }
    if (draft.modelId) {
      await trackActorTokens(actor, billing, {
        operation: "generate_workflow",
        modelId: draft.modelId,
        usage: draft.usage,
        responseId: draft.workflowId,
      });
    }
    return {
      drafted: true,
      workflowId: draft.workflowId,
      summary: trim(draft.summary, 400),
      note: "The draft is ready to refine in the workflow generator.",
    };
  },
);

/**
 * Find a workflow the actor may run, by id or by name.
 *
 * Name lookups only ever search the actor's visible set (`selectAll`, which is
 * org-scoped and fails closed), and the final `checkAccess` is the same one the
 * execute route performs.
 */
async function resolveRunnableWorkflow(actor: ToolActor, reference: string) {
  const workflows = await workflowRepository.selectAll(
    actor.userId,
    actor.organizationId,
  );
  const needle = reference.trim().toLowerCase();
  const match =
    workflows.find((workflow) => workflow.id === reference.trim()) ??
    workflows.find((workflow) => workflow.name.toLowerCase() === needle) ??
    (() => {
      const partial = workflows.filter((workflow) =>
        workflow.name.toLowerCase().includes(needle),
      );
      return partial.length === 1 ? partial[0] : undefined;
    })();
  if (!match) {
    throw new NavigatorToolError(
      "not_found",
      workflows.length
        ? `No workflow matches "${reference}". Available: ${workflows
            .slice(0, 15)
            .map((workflow) => workflow.name)
            .join(", ")}.`
        : "This workspace has no workflows yet.",
    );
  }
  const hasAccess = await workflowRepository.checkAccess(
    match.id,
    actor.userId,
    true,
    actor.organizationId,
  );
  if (!hasAccess) {
    throw new NavigatorToolError("forbidden", "This workflow cannot be run.");
  }
  return match;
}

function compactOutput(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length <= WORKFLOW_OUTPUT_LIMIT) return value;
    return `${json.slice(0, WORKFLOW_OUTPUT_LIMIT - 1)}…`;
  } catch {
    return String(value).slice(0, WORKFLOW_OUTPUT_LIMIT);
  }
}

export const executeWorkflowTool = defineTool(
  executeWorkflowSpec,
  async (actor, args) => {
    const ref = await resolveRunnableWorkflow(actor, args.workflow);
    // Workflow nodes may call models; refuse up front when the pool is empty.
    await assertActorCredits(actor);

    const workflow = await workflowRepository.selectStructureById(ref.id, {
      ignoreNote: true,
    });
    if (!workflow) {
      throw new NavigatorToolError("not_found", "Workflow not found.");
    }
    if (!workflow.nodes.some((node) => node.kind === NodeKind.Input)) {
      throw new NavigatorToolError(
        "invalid_workflow",
        "This workflow has no input node yet. Open it in the editor first.",
      );
    }

    const executor = createWorkflowExecutor({
      nodes: workflow.nodes,
      edges: workflow.edges,
    });
    const outputs: unknown[] = [];
    let failedNode: string | null = null;
    executor.subscribe((event) => {
      if (event.eventType !== "NODE_END" || event.node.name === "SKIP") return;
      const node = workflow.nodes.find((n) => n.id === event.node.name);
      if (!node) return;
      if (!event.isOk) {
        failedNode = node.name;
        return;
      }
      if (node.kind === NodeKind.Output) {
        outputs.push(
          event.node.output.getOutput({ nodeId: event.node.name, path: [] }),
        );
      }
    });

    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), EXECUTE_WORKFLOW_TIMEOUT_MS);
    });
    const run = executor.run(
      { query: (args.input ?? {}) as Record<string, unknown> },
      { disableHistory: true, timeout: EXECUTE_WORKFLOW_TIMEOUT_MS },
    );
    // Once the race is lost to the timeout nobody awaits the run any more; a
    // late rejection must not surface as an unhandled one.
    run.catch(() => undefined);
    try {
      const outcome = await Promise.race([run, timeout]);
      if (outcome === "timeout") {
        void executor.exit();
        return {
          workflow: ref.name,
          status: "timeout",
          note: "The workflow took longer than 60 seconds and was stopped. Run it from the editor for long jobs.",
        };
      }
      return {
        workflow: ref.name,
        status: outcome.isOk ? "success" : "failed",
        durationMs: Date.now() - startedAt,
        output: compactOutput(outputs.length === 1 ? outputs[0] : outputs),
        ...(outcome.isOk
          ? {}
          : {
              error: trim(
                errorToString(outcome.error) || "The workflow failed.",
                300,
              ),
              failedNode,
            }),
      };
    } catch (error) {
      logger.error(`execute_workflow failed for ${ref.id}:`, error);
      throw new NavigatorToolError("workflow_failed", "The workflow failed.");
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
);

export const WORKFLOW_TOOLS = [
  listWorkflowsTool,
  createWorkflowTool,
  generateWorkflowTool,
  executeWorkflowTool,
];
