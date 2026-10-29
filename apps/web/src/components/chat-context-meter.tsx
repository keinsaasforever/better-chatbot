"use client";

import type { ChatModel } from "app-types/chat";
import { getContextWindow } from "lib/ai/model-context-windows";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  type ContextTokenUsage,
  ContextTrigger,
} from "./ai-elements/context";

interface ChatContextMeterProps {
  usage?: ContextTokenUsage;
  usageModel?: ChatModel;
  selectedModel?: ChatModel;
  autoRouting?: boolean;
  className?: string;
}

/**
 * Composer context-window meter. usedTokens comes from the latest assistant
 * message's metadata.usage, which is the run's totalUsage across all steps -
 * an approximation of the true context size, hence the tilde in the UI.
 */
export function ChatContextMeter({
  usage,
  usageModel,
  selectedModel,
  autoRouting,
  className,
}: ChatContextMeterProps) {
  const model = autoRouting ? usageModel : (selectedModel ?? usageModel);
  const maxTokens = getContextWindow(model);
  const usedTokens = usage
    ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) ||
      (usage.totalTokens ?? 0)
    : 0;
  if (!usage || !model || !maxTokens || usedTokens <= 0) return null;
  return (
    <Context
      usedTokens={usedTokens}
      maxTokens={maxTokens}
      usage={usage}
      modelId={`${model.provider}/${model.model}`}
    >
      <ContextTrigger className={className} />
      <ContextContent side="top" align="end">
        <ContextContentHeader />
        <ContextContentBody>
          <ContextInputUsage />
          <ContextOutputUsage />
          <ContextReasoningUsage />
          <ContextCacheUsage />
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
  );
}
