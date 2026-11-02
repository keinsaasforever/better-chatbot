import "server-only";
import {
  GatewayAuthenticationError,
  GatewayForbiddenError,
} from "@ai-sdk/gateway";
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

/** The error, or anything in its `cause` chain, that matches. */
function findInChain(
  error: unknown,
  match: (candidate: unknown) => boolean,
): unknown {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (match(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function handleError(error: unknown) {
  // Vercel's free monthly credits cover only part of the catalog; the gateway
  // answers other models with this message (as a 500, not a 403).
  const freeTierRefusal = findInChain(
    error,
    (e) =>
      e instanceof Error &&
      /free tier users do not have access/i.test(e.message),
  );
  if (freeTierRefusal) {
    logger.warn(
      `Chat AI Gateway free-tier refusal: ${(freeTierRefusal as Error).message}`,
    );
    return "This model needs paid AI Gateway credits. Pick one of the free-tier models listed at vercel.com/ai-gateway/models?freeTier=true, or top up credits in your Vercel dashboard.";
  }
  // The gateway refused the request itself: no key and no OIDC token, or a
  // team whose AI Gateway is not activated (Vercel asks for a payment method
  // before it unlocks the free credits). Retrying cannot help, so say so.
  const gatewayRefusal = findInChain(
    error,
    (e) =>
      GatewayAuthenticationError.isInstance(e) ||
      GatewayForbiddenError.isInstance(e),
  );
  if (gatewayRefusal) {
    logger.warn(
      `Chat AI Gateway refusal: ${(gatewayRefusal as Error).message}`,
    );
    return "The AI Gateway refused the request. Open AI Gateway in your Vercel dashboard and activate it for this team (Vercel may ask for a payment method to unlock the free credits), or set AI_GATEWAY_API_KEY.";
  }
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
