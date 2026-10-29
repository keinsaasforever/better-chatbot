import "server-only";
import {
  LoadAPIKeyError,
  ToolUIPart,
  UIMessage,
  UIMessagePart,
  isToolUIPart,
} from "ai";
import { ChatMetadata, ManualToolConfirmTag } from "app-types/chat";
import { VercelAIWorkflowToolStreamingResultTag } from "app-types/workflow";
import { exclude } from "lib/utils";
import logger from "logger";
import { safe } from "ts-safe";

export function mergeSystemPrompt(
  ...prompts: (string | undefined | false)[]
): string {
  const filteredPrompts = prompts
    .map((prompt) => (prompt ? prompt.trim() : ""))
    .filter(Boolean);
  return filteredPrompts.join("\n\n");
}

export function handleError(error: unknown) {
  if (LoadAPIKeyError.isInstance(error)) {
    logger.warn(`Chat API key error: ${error.name}`);
    return "The selected model is not configured. Choose another model and try again.";
  }
  logger.error(error);
  const name = error instanceof Error ? error.name : "UnknownError";
  logger.error(`Route Error: ${name}`);
  return "The response could not be completed. Your message is saved; please try again.";
}

export function extractInProgressToolPart(message: UIMessage): ToolUIPart[] {
  if (message.role != "assistant") return [];
  if ((message.metadata as ChatMetadata)?.toolChoice != "manual") return [];
  return message.parts.filter(
    (part) =>
      isToolUIPart(part) &&
      part.state == "output-available" &&
      ManualToolConfirmTag.isMaybe(part.output),
  ) as ToolUIPart[];
}

export const convertToSavePart = <T extends UIMessagePart<any, any>>(
  part: T,
) => {
  return safe(
    exclude(part as any, ["providerMetadata", "callProviderMetadata"]) as T,
  )
    .map((v) => {
      if (isToolUIPart(v) && v.state.startsWith("output")) {
        if (VercelAIWorkflowToolStreamingResultTag.isMaybe(v.output)) {
          return {
            ...v,
            output: {
              ...v.output,
              history: v.output.history.map((h: any) => {
                return {
                  ...h,
                  result: undefined,
                };
              }),
            },
          };
        }
      }
      return v;
    })
    .unwrap();
};
