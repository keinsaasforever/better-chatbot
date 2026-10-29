import type { ModelMessage, ToolExecutionOptions } from "ai";

/** Options for ad-hoc server-side tool.execute() calls outside streamText. */
export function minimalToolExecutionOptions(options: {
  toolCallId: string;
  abortSignal?: AbortSignal;
  messages?: ModelMessage[];
}): ToolExecutionOptions<unknown> {
  return {
    toolCallId: options.toolCallId,
    abortSignal: options.abortSignal,
    messages: options.messages ?? [],
    context: undefined,
  };
}
