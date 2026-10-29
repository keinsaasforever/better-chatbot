import { type Tool, tool as createTool } from "ai";
import type { AgentFileBinding } from "app-types/agent";
import type { SandboxBillingContext } from "lib/e2b/create-sandbox";
import { SERVER_TOOL_EXECUTION_TIMEOUT_MS } from "lib/code-runner/timeouts";
import { toCodeToolOutput } from "lib/code-runner/tool-output";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import logger from "lib/logger";
import { jsExecutionSchema, jsExecutionTool } from "./js-run-tool";
import { pythonExecutionSchema, pythonExecutionTool } from "./python-run-tool";

/**
 * Same budget as the interactive run; the chat route's `toolMs` leaves room
 * around it for sandbox creation and artifact upload (see timeouts.ts).
 */
const EXECUTION_TIMEOUT_MS = SERVER_TOOL_EXECUTION_TIMEOUT_MS;

export type ServerCodeToolContext = SandboxBillingContext & {
  threadId?: string;
  /** Files bound to the active agent, staged alongside the thread's uploads. */
  agentFiles?: AgentFileBinding[];
};

/**
 * A code-execution tool that runs server-side, for turns with no browser.
 *
 * `pythonExecutionTool` / `jsExecutionTool` are declared without an `execute`,
 * which makes them client-side tools: the SDK emits the call and halts until
 * the browser sends a result back. A scheduled run has no browser, so the loop
 * stops with `finishReason: "tool-calls"` and the run ends with no answer.
 * These variants close that gap by calling `e2bRun` directly.
 *
 * The description and schema are the interactive tools' own, so the model sees
 * one contract either way.
 */
export function createServerCodeExecutionTool(
  type: "javascript" | "python",
  ctx: ServerCodeToolContext,
): Tool {
  const { description, schema } =
    type === "python"
      ? {
          description: pythonExecutionTool.description,
          schema: pythonExecutionSchema,
        }
      : { description: jsExecutionTool.description, schema: jsExecutionSchema };

  return createTool({
    description,
    inputSchema: jsonSchemaToZod(schema),
    execute: async ({ code }: { code: string }) => {
      // Imported here, not at module scope: these pull in
      // `@e2b/code-interpreter` and `pgDb`, and this module is reached from
      // tool loading on every chat request.
      const [
        { e2bRun },
        { collectAgentFiles, collectThreadAttachments, mergeStagedFiles },
      ] = await Promise.all([
        import("lib/code-runner/e2b-run"),
        import("lib/code-runner/stage-attachments"),
      ]);

      // Best-effort, mirroring /api/code-execution/e2b: missing attachments
      // must not block execution, the code simply runs without the files.
      let threadFiles: Awaited<ReturnType<typeof collectThreadAttachments>> =
        [];
      if (ctx.threadId) {
        try {
          threadFiles = await collectThreadAttachments(
            ctx.threadId,
            ctx.userId,
          );
        } catch (error) {
          logger.warn(
            `[e2b] attachment staging failed threadId=${ctx.threadId} error=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      let agentFiles: Awaited<ReturnType<typeof collectAgentFiles>> = [];
      if (ctx.agentFiles?.length) {
        try {
          agentFiles = await collectAgentFiles(ctx.agentFiles);
        } catch (error) {
          logger.warn(
            `[e2b] agent file staging failed error=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      const files = mergeStagedFiles(agentFiles, threadFiles);

      const startedAt = Date.now();
      const result = await e2bRun(
        code,
        type,
        {
          userId: ctx.userId,
          customerId: ctx.customerId,
          entityId: ctx.entityId,
        },
        EXECUTION_TIMEOUT_MS,
        files,
      );
      logger.info(
        `[e2b] server exec type=${type} success=${result.success} ms=${
          Date.now() - startedAt
        }${result.error ? ` error=${result.error}` : ""}`,
      );

      // Never throw: an execution failure is a result the model should read and
      // react to, which is the whole point of running the code server-side.
      return toCodeToolOutput(result);
    },
  });
}
