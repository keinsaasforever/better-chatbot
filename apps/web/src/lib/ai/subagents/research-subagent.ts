import {
  type LanguageModel,
  type UIMessage,
  tool as createTool,
  readUIMessageStream,
  stepCountIs,
  streamText,
  toUIMessageStream,
} from "ai";
import { aiTelemetry } from "lib/ai/telemetry";
import { searchKnowledgeBase } from "lib/ai/tools/knowledge-base/search-knowledge-base";
import {
  createExaContentsTool,
  createExaSearchTool,
} from "lib/ai/tools/web/web-search";
import { z } from "zod";

const RESEARCH_INSTRUCTIONS = `You are a research subagent working for a
planning assistant. Complete the assigned research task autonomously using
the available read-only tools (web search, web content extraction,
knowledge-base search). You must not attempt to change anything anywhere.

IMPORTANT: Finish with a clear, self-contained summary of your findings as
your final response. That summary is the ONLY thing returned to the main
agent, so include every fact it needs: concrete numbers, names, URLs, and
trade-offs. If you found nothing useful, say so explicitly.`;

export type ResearchToolOutput =
  | { status: "running"; message: UIMessage }
  | { status: "done"; summary: string; toolCallCount: number };

/**
 * Plan-mode research subagent, following the AI SDK subagent pattern: the
 * tool's generator execute streams the subagent's accumulated UIMessage as
 * preliminary results (live progress in the UI), the FINAL yield is a
 * compact summary object (that is what persists to chat_message.parts), and
 * toModelOutput hands the main agent only the summary text so its context
 * stays lean no matter how many tokens the subagent burned. The main agent
 * fans out several `research` calls in one assistant turn; the SDK executes
 * them concurrently.
 */
export const createResearchAgentTool = ({
  model,
  customerId,
  entityId,
  projectId,
  organizationId,
  threadId,
  modelId,
}: {
  model: LanguageModel;
  customerId?: string;
  entityId?: string;
  projectId?: string;
  organizationId?: string;
  threadId?: string;
  modelId?: string;
}) =>
  createTool<{ task: string }, ResearchToolOutput, Record<string, unknown>>({
    description:
      "Delegate a focused research task to a parallel research agent. The " +
      "agent searches the web and the project's knowledge base, then " +
      "returns a compact summary of findings. Use this when the plan needs " +
      "facts you do not have. Fan out MULTIPLE independent research calls " +
      "in the SAME response - one per question - so they run in parallel. " +
      "Each task must be self-contained with all context the agent needs. " +
      "Do NOT use it for things you already know.",
    inputSchema: z.object({
      task: z
        .string()
        .min(1)
        .describe(
          "The research question or task, self-contained with all context needed",
        ),
    }),
    execute: async function* ({ task }, { abortSignal }) {
      const result = streamText({
        model,
        system: RESEARCH_INSTRUCTIONS,
        prompt: task,
        tools: {
          webSearch: createExaSearchTool(customerId, entityId),
          webContent: createExaContentsTool(customerId, entityId),
          searchKnowledgeBase: searchKnowledgeBase(customerId, projectId),
        },
        stopWhen: stepCountIs(8),
        abortSignal,
        maxRetries: 0,
        experimental_telemetry: aiTelemetry("chat.research-subagent", {
          organizationId,
          threadId,
          modelId,
        }),
      });

      let lastMessage: UIMessage | undefined;
      for await (const message of readUIMessageStream({
        stream: toUIMessageStream({ stream: result.fullStream }),
      })) {
        lastMessage = message;
        yield { status: "running" as const, message };
      }

      let summary = "";
      for (const part of lastMessage?.parts ?? []) {
        if (part.type === "text" && part.text.trim()) {
          summary = part.text.trim();
        }
      }
      const toolCallCount =
        lastMessage?.parts.filter((p) => p.type.startsWith("tool-")).length ??
        0;
      yield {
        status: "done" as const,
        summary: summary || "The research agent returned no summary.",
        toolCallCount,
      };
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value:
        output.status === "done" ? output.summary : "Research in progress.",
    }),
  });
