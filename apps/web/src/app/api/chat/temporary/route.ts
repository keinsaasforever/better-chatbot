import { billingRunKey } from "@/lib/billing/usage-idempotency";
import { generateUUID } from "lib/utils";
import {
  CreditsExhaustedError,
  assertCreditsAvailable,
  requireBillingContext,
  trackUsage,
} from "@/lib/gate";
import {
  UIMessage,
  convertToModelMessages,
  createUIMessageStreamResponse,
  smoothStream,
  streamText,
  toUIMessageStream,
} from "ai";
import { withAuth } from "auth/route-guard";
import { customModelProvider } from "lib/ai/models";
import {
  buildCurrentDateTimePrompt,
  buildUserSystemPrompt,
} from "lib/ai/prompts";
import { aiTelemetry } from "lib/ai/telemetry";
import { getUserPreferences } from "lib/user/server";
import globalLogger from "logger";

import { colorize } from "consola/utils";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Temporary Chat API: `),
});

export const POST = withAuth(async (request, session) => {
  try {
    const json = await request.json();

    const { messages, chatModel, instructions } = json as {
      messages: UIMessage[];
      chatModel?: {
        provider: string;
        model: string;
      };
      instructions?: string;
    };
    logger.info(`model: ${chatModel?.provider}/${chatModel?.model}`);
    // Unique per request. The key used to be built from the last message's id,
    // which falls back to a literal "unknown" when the client omits one — every
    // such request across a customer then collided on one key and only the
    // first was ever billed.
    const runId = generateUUID();
    const model = customModelProvider.getModel(chatModel);
    const userPreferences =
      (await getUserPreferences(session.user.id)) || undefined;
    const billing = await requireBillingContext().catch(() => ({
      customerId: session.user.id,
      userId: session.user.id,
      entityId: undefined,
    }));

    // Temporary chats are metered like any other chat, so they must respect the
    // same credit gate — otherwise they are an unmetered way past the cap.
    try {
      await assertCreditsAvailable({
        customerId: billing.customerId,
        entityId: billing.entityId,
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

    const result = streamText({
      model,
      experimental_telemetry: aiTelemetry("chat.temporary", {
        provider: chatModel?.provider,
        modelId: chatModel?.model,
        isTemporary: true,
        hasInstructions: Boolean(instructions),
      }),
      // Date last: keeps the prefix byte-stable so it stays cacheable.
      system: `${buildUserSystemPrompt(session.user, userPreferences)} ${
        instructions ? `\n\n${instructions}` : ""
      }\n\n${buildCurrentDateTimePrompt()}`.trim(),
      messages: await convertToModelMessages(messages),
      experimental_transform: smoothStream({ chunking: "word" }),
      onEnd: async ({ usage }) => {
        // Track token usage for temporary chat
        if (usage?.totalTokens && usage?.inputTokens && usage?.outputTokens) {
          try {
            await trackUsage({
              kind: "tokens",
              customerId: billing.customerId,
              entityId: billing.entityId,
              modelId: `${chatModel?.provider}/${chatModel?.model}`,
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens,
              cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
              noCacheTokens: usage.inputTokenDetails?.noCacheTokens,
              idempotencyKey: billingRunKey({
                scope: "temp-chat",
                // Null only in the community edition, where `trackUsage` drops
                // the event before the key is read.
                subject: billing.customerId ?? session.user.id,
                runId,
              }),
              properties: {
                temporary: true,
                instructions: instructions ? "yes" : "no",
              },
            });
            logger.info(`[Autumn] Temporary chat tokens tracked successfully`);
          } catch (err) {
            logger.error("[Autumn] Failed to track temporary chat usage:", err);
          }
        }
      },
    });

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (error: any) {
    logger.error(error);
    return new Response(error.message || "Oops, an error occured!", {
      status: 500,
    });
  }
});
