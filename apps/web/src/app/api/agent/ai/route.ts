import {
  CreditsExhaustedError,
  assertCreditsAvailable,
  requireBillingContext,
  trackUsage,
} from "@/lib/gate";
import { createHash } from "node:crypto";
import { Output, createTextStreamResponse, streamText, toTextStream } from "ai";

import { ChatModel } from "app-types/chat";
import { customModelProvider } from "lib/ai/models";
import { buildAgentGenerationPrompt } from "lib/ai/prompts";
import { aiTelemetry } from "lib/ai/telemetry";
import globalLogger from "logger";

import { AgentGenerateSchema } from "app-types/agent";
import { withAuth } from "auth/route-guard";
import { colorize } from "consola/utils";
import { composio } from "lib/composio/client";
import { workflowRepository } from "lib/db/repository";
import { objectFlow } from "lib/utils";
import { safe } from "ts-safe";
import { z } from "zod";
import {
  loadAppDefaultTools,
  loadComposioTools,
  loadMcpToolsStateless,
} from "../../chat/shared.chat";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Agent Generate API: `),
});

export const POST = withAuth(async (request, session) => {
  try {
    const json = await request.json();

    const { chatModel, message = "hello" } = json as {
      chatModel?: ChatModel;
      message: string;
    };

    logger.info(`chatModel: ${chatModel?.provider}/${chatModel?.model}`);

    // Agent generation is a metered LLM call — gate it on the credit pool too.
    const generationBilling = await requireBillingContext().catch(() => ({
      customerId: session.user.id,
      userId: session.user.id,
      entityId: undefined,
    }));
    try {
      await assertCreditsAvailable({
        customerId: generationBilling.customerId,
        entityId: generationBilling.entityId,
      });
    } catch (error) {
      if (error instanceof CreditsExhaustedError) {
        return Response.json(
          { error: error.message, code: "CREDITS_EXHAUSTED" },
          { status: 402 },
        );
      }
      throw error;
    }

    const toolNames = new Set<string>();

    await safe(loadAppDefaultTools)

      .ifOk((appTools) => {
        objectFlow(appTools).forEach((_, toolName) => {
          toolNames.add(toolName);
        });
      })
      .unwrap();

    // Load MCP tools stateless (RPC-based)
    await safe(loadMcpToolsStateless(session.user.id))
      .ifOk((tools) => {
        objectFlow(tools).forEach((mcp) => {
          toolNames.add(mcp._originToolName);
        });
      })
      .unwrap();

    await safe(
      workflowRepository.selectExecuteAbility(
        session.user.id,
        (
          session.session as
            | { activeOrganizationId?: string | null }
            | undefined
        )?.activeOrganizationId,
      ),
    )
      .ifOk((tools) => {
        tools.forEach((tool) => {
          toolNames.add(tool.name);
        });
      })
      .unwrap();

    // Load connected Composio tool action names (e.g. GMAIL_SEND_EMAIL).
    const connectedAppSlugs = new Set<string>();
    await safe(loadComposioTools(session.user.id))
      .ifOk((tools) => {
        Object.keys(tools).forEach((toolName) => {
          toolNames.add(toolName);
          // Composio action names start with the app slug in uppercase: GMAIL_…
          const slug = toolName.split("_")[0]?.toLowerCase();
          if (slug) connectedAppSlugs.add(slug);
        });
      })
      .unwrap();

    // Fetch the full Composio toolkit catalog so the AI knows which apps
    // exist and can suggest them even if the user hasn't connected them yet.
    // We cap at 150 toolkits to keep the prompt size reasonable.
    const unconnectedApps: Array<{ slug: string; name: string }> = [];
    await safe(async () => {
      const session_ = await composio.create(session.user.id);
      const allItems: any[] = [];
      let cursor: string | undefined;
      do {
        const page: any = await session_.toolkits({
          limit: 50,
          ...(cursor ? { nextCursor: cursor } : {}),
        });
        allItems.push(...(page.items ?? []));
        cursor = page.nextCursor ?? undefined;
        if (allItems.length >= 150) break;
      } while (cursor);
      return allItems;
    })
      .ifOk((items) => {
        items
          .filter((t: any) => !t.isNoAuth)
          .forEach((t: any) => {
            if (!connectedAppSlugs.has(t.slug)) {
              unconnectedApps.push({ slug: t.slug, name: t.name });
            }
          });
      })
      .unwrap();

    const dynamicAgentTable = AgentGenerateSchema.extend({
      tools: z
        .array(
          z.enum(
            Array.from(toolNames).length > 0
              ? ([
                  Array.from(toolNames)[0],
                  ...Array.from(toolNames).slice(1),
                ] as [string, ...string[]])
              : ([""] as [string]),
          ),
        )
        .describe("Agent allowed tools name")
        .nullable()
        .default([]),
    });

    const system = buildAgentGenerationPrompt(
      Array.from(toolNames),
      unconnectedApps,
    );

    // Deterministic per generation request so a retry does not double-bill.
    const agentGenHash = createHash("sha256")
      .update(`${chatModel?.provider}/${chatModel?.model}:${message}`)
      .digest("hex");

    const result = streamText({
      model: customModelProvider.getModel(chatModel),
      system,
      prompt: message,
      experimental_telemetry: aiTelemetry("agent.generate", {
        provider: chatModel?.provider,
        modelId: chatModel?.model,
        toolCount: toolNames.size,
      }),
      output: Output.object({
        schema: dynamicAgentTable,
      }),
      onEnd: async ({ usage }) => {
        // Track token usage for agent generation
        if (usage?.totalTokens && usage?.inputTokens && usage?.outputTokens) {
          try {
            const billing = await requireBillingContext().catch(() => ({
              customerId: session.user.id,
              userId: session.user.id,
              entityId: undefined,
            }));
            const { customerId, entityId } = billing;
            await trackUsage({
              kind: "tokens",
              customerId,
              entityId,
              modelId: `${chatModel?.provider}/${chatModel?.model}`,
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              idempotencyKey: `agent-gen-${customerId}-${agentGenHash}`,
              properties: {
                operation: "agent_generation",
                message: message.substring(0, 100), // First 100 chars for context
              },
            });
            logger.info(
              `[Autumn] Agent generation tokens tracked successfully`,
            );
          } catch (err) {
            logger.error(
              "[Autumn] Failed to track agent generation usage:",
              err,
            );
          }
        }
      },
    });

    return createTextStreamResponse({
      stream: toTextStream({ stream: result.stream }),
    });
  } catch (error) {
    logger.error(error);
    return new Response("Internal Server Error", { status: 500 });
  }
});
