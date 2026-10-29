import { withAuth } from "auth/route-guard";
import { createWorkflowExecutor } from "lib/ai/workflow/executor/workflow-executor";
import { workflowRepository } from "lib/db/repository";
import { encodeWorkflowEvent } from "lib/ai/workflow/shared.workflow";
import logger from "logger";
import { colorize } from "consola/utils";
import { safeJSONParse, toAny } from "lib/utils";

export const POST = withAuth(
  async (request, session, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { query } = await request.json();
    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null } | undefined
    )?.activeOrganizationId;
    const hasAccess = await workflowRepository.checkAccess(
      id,
      session.user.id,
      true,
      activeOrganizationId,
    );
    if (!hasAccess) {
      return new Response("Unauthorized", { status: 401 });
    }
    const workflow = await workflowRepository.selectStructureById(id);
    if (!workflow) {
      return new Response("Workflow not found", { status: 404 });
    }

    const wfLogger = logger.withDefaults({
      message: colorize("cyan", `WORKFLOW '${workflow.name}' `),
    });
    const app = createWorkflowExecutor({
      edges: workflow.edges,
      nodes: workflow.nodes,
      logger: wfLogger,
      caller: {
        userId: session.user.id,
        organizationId: activeOrganizationId,
      },
    });

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        let isAborted = false;
        // Subscribe to workflow events
        app.subscribe((evt) => {
          if (isAborted) return;
          if (
            (evt.eventType == "NODE_START" || evt.eventType == "NODE_END") &&
            evt.node.name == "SKIP"
          ) {
            return;
          }
          try {
            const err = toAny(evt)?.error;
            if (err) {
              toAny(evt).error = {
                name: err.name || "ERROR",
                message: err?.message || safeJSONParse(err).value,
              };
            }
            // Use custom encoding instead of SSE format
            const data = encodeWorkflowEvent(evt);
            controller.enqueue(encoder.encode(data));
            // Close stream when workflow ends
            if (evt.eventType === "WORKFLOW_END") {
              controller.close();
            }
          } catch (error) {
            logger.error("Stream write error:", error);
            controller.error(error);
          }
        });

        // Handle client disconnection
        request.signal.addEventListener("abort", async () => {
          isAborted = true;
          void app.exit();
          controller.close();
        });

        // Start the workflow
        app
          .run(
            { query },
            {
              disableHistory: true,
              timeout: 1000 * 60 * 5,
            },
          )
          .then((result) => {
            if (!result.isOk) {
              logger.error("Workflow execution error:", result.error);
            }
          });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  },
);
