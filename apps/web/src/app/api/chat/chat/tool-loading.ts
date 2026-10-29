import "server-only";
import { isComposioConfigured } from "lib/composio/config";
import { minimalToolExecutionOptions } from "@/lib/ai/tools/minimal-tool-execution-options";
import { resolveAllowedAppDefaultToolkits } from "@/lib/ai/tools/resolve-allowed-toolkits";
import { Tool, ToolUIPart, getToolName } from "ai";
import { ChatMention, ManualToolConfirmTag } from "app-types/chat";
import { VercelAIMcpTool, VercelAIMcpToolTag } from "app-types/mcp";
import {
  VercelAIWorkflowTool,
  VercelAIWorkflowToolTag,
} from "app-types/workflow";
import { MANUAL_REJECT_RESPONSE_PROMPT } from "lib/ai/prompts";
import { AppDefaultToolkit, DefaultToolName } from "lib/ai/tools";
import { createServerCodeExecutionTool } from "lib/ai/tools/code/server-code-tools";
import {
  createAnalyzeDocumentTool,
  createEditDocumentTool,
} from "lib/ai/tools/document/create-document-tools";
import { createPdfTool } from "lib/ai/tools/document/create-pdf-tool";
import { createQueryProjectGraphTool } from "lib/ai/tools/knowledge-base/query-project-graph";
import { createTabularReviewToolWithExecute } from "lib/ai/tools/tabular/create-tabular-tool";
import { APP_DEFAULT_TOOL_KIT } from "lib/ai/tools/tool-kit";
import type { AgentFileBinding } from "app-types/agent";
import {
  createExaContentsTool,
  createExaSearchTool,
} from "lib/ai/tools/web/web-search";
import { hasPreinstalledDocumentLibraries } from "lib/e2b/sandbox-registry";
import { errorToString, objectFlow } from "lib/utils";
import logger from "logger";
import { safe } from "ts-safe";

export function excludeToolExecution(
  tool: Record<string, Tool>,
): Record<string, Tool> {
  return objectFlow(tool).map((value) => {
    // Manual mode must preserve the SDK tool definition (output schemas,
    // provider options, annotations, and approval settings) while preventing
    // the model loop from executing it automatically.
    return {
      ...value,
      execute: undefined,
    } as Tool;
  });
}

/**
 * Wrap every executable tool so each invocation is counted in Autumn.
 *
 * Composio tools arrive from its SDK with their own `execute`, so there is no
 * chokepoint of ours they pass through — wrapping at load time is the one place
 * that sees every call exactly once.
 *
 * Routed through the billing gate rather than the provider directly: this file
 * ships in both editions, and the community build has no billing provider.
 *
 * The count is fired and not awaited: a tool call must not wait on a billing
 * round trip. `trackWithRetry` already swallows its own failures, so the extra
 * `catch` here only guards against an unexpected synchronous throw.
 *
 * Returns a new record; the cached tool objects are never mutated, so a cache
 * hit cannot end up double-wrapped.
 */
export function meterToolCalls(
  tools: Record<string, Tool>,
  // `string | null` mirrors `BillingContext` from the gate, where a customer
  // id is absent until one is resolved.
  billing: { customerId?: string | null; entityId?: string },
): Record<string, Tool> {
  const { customerId, entityId } = billing;
  if (!customerId) return tools;

  return objectFlow(tools).map((tool, toolName) => {
    const execute = tool.execute;
    if (typeof execute !== "function") return tool;

    return {
      ...tool,
      execute: (input: any, options: any) => {
        void import("lib/gate")
          .then(({ trackUsage }) =>
            trackUsage({
              kind: "toolCall",
              customerId,
              entityId,
              toolCallId: options?.toolCallId ?? `${String(toolName)}-unknown`,
              toolName: String(toolName),
            }),
          )
          .catch(() => {
            // Counting is best-effort; the tool call is what matters.
          });

        return execute.call(tool, input, options);
      },
    } as Tool;
  });
}

export function manualToolExecuteByLastMessage(
  part: ToolUIPart,
  tools: Record<string, VercelAIMcpTool | VercelAIWorkflowTool | Tool>,
  _userId: string,
  abortSignal?: AbortSignal,
) {
  const { input } = part;

  const toolName = getToolName(part);

  const tool = tools[toolName];
  return safe(() => {
    if (!tool) throw new Error(`tool not found: ${toolName}`);
    if (!ManualToolConfirmTag.isMaybe(part.output))
      throw new Error("manual tool confirm not found");
    return part.output;
  })
    .map(async ({ confirm }) => {
      if (!confirm) return MANUAL_REJECT_RESPONSE_PROMPT;
      if (VercelAIWorkflowToolTag.isMaybe(tool)) {
        return tool.execute!(
          input,
          minimalToolExecutionOptions({
            toolCallId: part.toolCallId,
            abortSignal: abortSignal ?? new AbortController().signal,
          }),
        );
      } else if (VercelAIMcpToolTag.isMaybe(tool)) {
        // Direct ephemeral client execution (server-side context)
        // Cannot use RPC fetch here because we're already in server context
        const { createEphemeralMCPClient } = await import(
          "lib/ai/mcp/ephemeral-client"
        );
        const execClient = await createEphemeralMCPClient(
          tool._mcpServerId,
          _userId,
        );
        if (!execClient) {
          throw new Error("MCP server not found");
        }
        try {
          const result = await execClient.callTool(
            tool._originToolName,
            input,
            abortSignal,
          );
          return result;
        } finally {
          await execClient.disconnect();
        }
      }
      return tool.execute!(
        input,
        minimalToolExecutionOptions({
          toolCallId: part.toolCallId,
          abortSignal: abortSignal ?? new AbortController().signal,
        }),
      );
    })
    .ifFail((error) => ({
      isError: true,
      statusMessage: `tool call fail: ${toolName}`,
      error: errorToString(error),
    }))
    .unwrap();
}

/**
 * Loads tools from Composio for the given user using the VercelProvider.
 * session.tools() returns Vercel AI SDK-compatible tools with built-in
 * execute functions — no manual connection or agentic loop needed.
 */
/**
 * Per-instance memo for Composio tools.
 *
 * `session.tools()` is a network round-trip that previously ran on *every*
 * chat message (~500ms in production). The returned tools are live AI-SDK tool
 * objects with bound `execute` closures, so they cannot be serialized to a
 * shared cache (Redis) — only memoized in-process. This memo is therefore
 * per-warm-instance: it removes the repeat cost for subsequent messages handled
 * by the same serverless instance, which is the common case under sustained
 * load. `inflight` provides single-flight so N concurrent first-messages for
 * one user collapse to a single upstream call instead of a stampede.
 *
 * Override the TTL with COMPOSIO_TOOLS_TTL_MS (default 5 min); set to 0 to
 * disable memoization entirely.
 */
const COMPOSIO_TOOLS_TTL_MS = (() => {
  const raw = Number(process.env.COMPOSIO_TOOLS_TTL_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5 * 60 * 1000;
})();
type ComposioToolsEntry = {
  tools: Record<string, Tool>;
  expiresAt: number;
};
const composioToolsCache = new Map<string, ComposioToolsEntry>();
const composioToolsInflight = new Map<string, Promise<Record<string, Tool>>>();

/**
 * Whether this user has at least one connected Composio integration.
 *
 * The Tool Router returns the same four COMPOSIO_* meta-tools for everyone,
 * connected or not, so their schemas were riding in every prompt of every user
 * — including users who have never connected anything. Measured on one
 * production thread, the system prompt plus the bound tool schemas accounted
 * for ~9,700 tokens of every single request.
 *
 * `isConnected: true` is a server-side filter, so `limit: 1` answers the
 * question in one small round trip rather than enumerating accounts.
 *
 * **Fails open.** The repo already documents that these toolkit flags lag
 * behind, or miss accounts created through other auth flows (see the comments
 * in `api/connections/route.ts` and `lib/composio/toolkit-connections.ts`).
 * A wrongly-withheld tool is a broken feature; a wrongly-loaded one is only a
 * few tokens. On any error, or any doubt, load the tools.
 */
const fetchHasComposioConnection = async (userId: string): Promise<boolean> => {
  const { composio } = await import("lib/composio/client");
  const session = await composio.create(userId);
  const page = (await session.toolkits({ limit: 1, isConnected: true })) as {
    items?: unknown[];
  } | null;
  // A missing or reshaped `items` is doubt, not evidence of zero connections -
  // only an empty array is. Doubt falls open, same as a thrown error.
  if (!Array.isArray(page?.items)) return true;
  return page.items.length > 0;
};

/**
 * A negative answer is cached only briefly: someone who connects their first
 * integration should see their tools within a minute, not after the full tool
 * TTL. A positive answer is stable and rides the same TTL as the tools.
 */
const COMPOSIO_UNCONNECTED_TTL_MS = 60 * 1000;

type ComposioConnectionEntry = { connected: boolean; expiresAt: number };
const composioConnectionCache = new Map<string, ComposioConnectionEntry>();
const composioConnectionInflight = new Map<string, Promise<boolean>>();

const hasComposioConnection = async (userId: string): Promise<boolean> => {
  const now = Date.now();
  const cached = composioConnectionCache.get(userId);
  if (cached && cached.expiresAt > now) return cached.connected;

  const existing = composioConnectionInflight.get(userId);
  if (existing) return await existing;

  const promise = fetchHasComposioConnection(userId)
    .then((connected) => {
      composioConnectionCache.set(userId, {
        connected,
        expiresAt:
          Date.now() +
          (connected ? COMPOSIO_TOOLS_TTL_MS : COMPOSIO_UNCONNECTED_TTL_MS),
      });
      return connected;
    })
    .catch((error) => {
      // Deliberately not cached: retry on the next turn rather than withhold
      // tools for a whole TTL because one lookup failed.
      logger.warn("Composio connection check failed; loading tools:", error);
      return true;
    })
    .finally(() => {
      composioConnectionInflight.delete(userId);
    });
  composioConnectionInflight.set(userId, promise);
  return await promise;
};

/**
 * Prefixed onto every Composio tool description at load time.
 *
 * The Tool Router's own descriptions arrive over the network worded broadly
 * enough ("accomplish any task") to outcompete first-party tools in the
 * model's choice. We cannot edit them at the source, but we own the tool
 * objects once loaded — so the fallback ranking is stamped into the text the
 * model actually reads, mirroring the sandbox opt-out below. The system
 * prompt states the same rule (`COMPOSIO_FALLBACK_SYSTEM_PROMPT`); the
 * description carries it for models that weigh tool text over prompt text.
 */
export const COMPOSIO_FALLBACK_DESCRIPTION_PREFIX =
  "LAST RESORT — use only when no built-in or MCP tool matches the request. ";

const demoteComposioDescriptions = (
  tools: Record<string, Tool>,
): Record<string, Tool> =>
  objectFlow(tools).map(
    (tool) =>
      ({
        ...tool,
        description: `${COMPOSIO_FALLBACK_DESCRIPTION_PREFIX}${tool.description ?? ""}`,
      }) as Tool,
  );

const fetchComposioTools = async (
  userId: string,
): Promise<Record<string, Tool>> => {
  const { composio } = await import("lib/composio/client");
  // Composio's Tool Router ships its own code sandbox and it defaults to ON,
  // which bound COMPOSIO_REMOTE_WORKBENCH + COMPOSIO_REMOTE_BASH_TOOL on every
  // turn. Those competed with our own E2B tools — ahead of them in the tool
  // list, and with descriptions fetched over the network that we can neither
  // see nor edit — so the model reached for a bash sandbox instead of
  // e2b-sandbox/python-execution. Code execution belongs to E2B here.
  const session = await composio.create(userId, { sandbox: { enable: false } });
  const tools = await session.tools();
  return demoteComposioDescriptions(
    (tools as unknown as Record<string, Tool>) ?? {},
  );
};

export const loadComposioTools = async (
  userId: string,
): Promise<Record<string, Tool>> => {
  try {
    if (!userId) return {};
    if (!isComposioConfigured()) return {};

    // Nothing connected: the meta-tools can only offer to connect something,
    // which the UI does better. Skip them and keep their schemas out of the
    // prompt.
    if (!(await hasComposioConnection(userId))) return {};

    if (COMPOSIO_TOOLS_TTL_MS === 0) {
      return await fetchComposioTools(userId);
    }

    const now = Date.now();
    const cached = composioToolsCache.get(userId);
    if (cached && cached.expiresAt > now) {
      return cached.tools;
    }

    // Single-flight: coalesce concurrent loads for the same user.
    const existing = composioToolsInflight.get(userId);
    if (existing) return await existing;

    const promise = fetchComposioTools(userId)
      .then((tools) => {
        composioToolsCache.set(userId, {
          tools,
          expiresAt: Date.now() + COMPOSIO_TOOLS_TTL_MS,
        });
        return tools;
      })
      .finally(() => {
        composioToolsInflight.delete(userId);
      });
    composioToolsInflight.set(userId, promise);
    return await promise;
  } catch (error) {
    logger.warn("Failed to load Composio tools:", error);
    return {};
  }
};

export const loadAppDefaultTools = (opt?: {
  mentions?: ChatMention[];
  allowedAppDefaultToolkit?: string[];
  userId?: string;
  billingCustomerId?: string | null;
  billingEntityId?: string;
  projectId?: string;
  threadId?: string;
  /** Files bound to the active agent, staged into every sandbox run. */
  agentFiles?: AgentFileBinding[];
  /** No browser will run client-side tools this turn (scheduled/loopback run). */
  headless?: boolean;
}) =>
  safe(APP_DEFAULT_TOOL_KIT)
    .map((tools) => {
      const allowedAppDefaultToolkit = resolveAllowedAppDefaultToolkits({
        allowedAppDefaultToolkit: opt?.allowedAppDefaultToolkit,
        projectId: opt?.projectId,
      });

      const fromToolkits = allowedAppDefaultToolkit.reduce(
        (acc, key) => ({ ...acc, ...tools[key] }),
        {} as Record<string, Tool>,
      );

      // Pinning specific tools is what a `@tool` mention means, so honour it —
      // but only when the user actually mentioned one. This used to trigger on
      // `mentions.length`, i.e. ANY mention type, while filtering to
      // `defaultTool`. Selecting an agent injects an `{type:"agent"}` mention
      // on its own, so every agent turn silently resolved to zero app default
      // tools — losing python-execution and e2b-sandbox while leaving every
      // Composio tool bound, and leaving the system prompt recommending a
      // python-execution that was not there.
      const defaultToolMentions = (opt?.mentions ?? []).filter(
        (m) => m.type == "defaultTool",
      );
      if (defaultToolMentions.length === 0) return fromToolkits;

      const mentioned = Array.from(Object.values(tools)).reduce((acc, t) => {
        const allowed = objectFlow(t).filter((_, k) =>
          defaultToolMentions.some((m) => m.name == k),
        );
        return { ...acc, ...allowed };
      }, {}) as Record<string, Tool>;

      // Code execution stays available alongside the pinned tools: an agent
      // that mentions a table builder still needs a sandbox to compute what
      // goes in the table. `fromToolkits` is used as the source, so a user who
      // switched Code off in the tool menu keeps it off.
      const codeTools = allowedAppDefaultToolkit.includes(
        AppDefaultToolkit.Code,
      )
        ? (tools[AppDefaultToolkit.Code] ?? {})
        : {};

      return { ...codeTools, ...mentioned };
    })
    .map((loadedTools) => {
      const updatedTools = { ...loadedTools };

      // Replace web search tools with userId-bound versions for Autumn tracking
      if (opt?.userId) {
        if (updatedTools[DefaultToolName.WebSearch]) {
          updatedTools[DefaultToolName.WebSearch] = createExaSearchTool(
            opt.billingCustomerId ?? opt.userId,
            opt.billingEntityId,
          );
        }
        if (updatedTools[DefaultToolName.WebContent]) {
          updatedTools[DefaultToolName.WebContent] = createExaContentsTool(
            opt.billingCustomerId ?? opt.userId,
            opt.billingEntityId,
          );
        }
      }

      // Bind userId to document & tabular tools so they can execute server-side
      if (opt?.userId) {
        if (updatedTools[DefaultToolName.AnalyzeDocument]) {
          updatedTools[DefaultToolName.AnalyzeDocument] =
            createAnalyzeDocumentTool(opt.userId, opt.projectId);
        }
        if (updatedTools[DefaultToolName.EditDocument]) {
          updatedTools[DefaultToolName.EditDocument] = createEditDocumentTool(
            opt.userId,
          );
        }
        if (updatedTools[DefaultToolName.CreateTabularReview]) {
          updatedTools[DefaultToolName.CreateTabularReview] =
            createTabularReviewToolWithExecute(opt.userId, opt.projectId);
        }
        // The graph tool only makes sense inside a project chat.
        if (updatedTools[DefaultToolName.QueryProjectGraph]) {
          if (opt.projectId) {
            updatedTools[DefaultToolName.QueryProjectGraph] =
              createQueryProjectGraphTool(opt.userId, opt.projectId);
          } else {
            delete updatedTools[DefaultToolName.QueryProjectGraph];
          }
        }
        if (updatedTools[DefaultToolName.CreatePdf]) {
          // Rendering is WeasyPrint inside the sandbox, and only the document
          // template has it. Offering the tool against the stock interpreter
          // would mean every call fails on the import, so drop it instead —
          // the model then reaches for python-execution, which still works.
          if (hasPreinstalledDocumentLibraries()) {
            updatedTools[DefaultToolName.CreatePdf] = createPdfTool({
              userId: opt.userId,
              customerId: opt.billingCustomerId ?? opt.userId,
              entityId: opt.billingEntityId,
            });
          } else {
            delete updatedTools[DefaultToolName.CreatePdf];
          }
        }
      }

      // Code tools are client-side by default (declared without `execute`), so
      // a run with no browser halts on the call and ends with no answer. Swap
      // in server-executing variants when nobody is watching.
      if (opt?.headless && opt.userId) {
        const codeContext = {
          userId: opt.userId,
          customerId: opt.billingCustomerId ?? opt.userId,
          entityId: opt.billingEntityId,
          threadId: opt.threadId,
          agentFiles: opt.agentFiles,
        };
        if (updatedTools[DefaultToolName.PythonExecution]) {
          updatedTools[DefaultToolName.PythonExecution] =
            createServerCodeExecutionTool("python", codeContext);
        }
        if (updatedTools[DefaultToolName.JavascriptExecution]) {
          updatedTools[DefaultToolName.JavascriptExecution] =
            createServerCodeExecutionTool("javascript", codeContext);
        }
        // e2b-sandbox deploys a live preview panel for the user to open. Bound
        // headlessly it can only produce another unanswerable call.
        delete updatedTools[DefaultToolName.E2BSandbox];
      }

      return updatedTools;
    })
    .ifFail((e) => {
      console.error(e);
      throw e;
    })
    .orElse({} as Record<string, Tool>);
