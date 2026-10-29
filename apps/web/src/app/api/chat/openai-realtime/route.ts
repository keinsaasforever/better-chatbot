import { ChatMention } from "app-types/chat";
import { withAuth } from "auth/route-guard";
import { colorize } from "consola/utils";
import { getVoiceGateway } from "lib/ai/speech/voice-gateway.server";
import {
  VOICE_REALTIME_MODEL,
  getAiGatewayTeamIdOrSlug,
  isAiGatewayConfigured,
  parseVoiceLanguage,
} from "lib/ai/speech/voice-realtime-config";
import globalLogger from "lib/logger";
import { resolveVoiceBrowserSuppression } from "lib/voice/browser-gate";
import { buildOpenAIRealtimeToolSetup } from "lib/voice/openai-tools";
import { buildVoiceAgentContext } from "lib/voice/voice-session";

const logger = globalLogger.withDefaults({
  message: colorize("blackBright", `Voice Realtime Gateway: `),
});

function resolveVoiceRequestContext(
  request: Request,
  body: {
    sessionConfig?: {
      providerOptions?: {
        voiceChat?: { agentId?: string; mentions?: ChatMention[] };
      };
    };
    agentId?: string;
    mentions?: ChatMention[];
  },
) {
  const url = new URL(request.url);
  const voiceChatMeta = body.sessionConfig?.providerOptions?.voiceChat;

  return {
    // Still read from the query: the AI SDK's realtime transport POSTs this URL
    // with a body we do not control, so this is the only way the agent reaches
    // the route on that path. It is one uuid, so it cannot grow the URL.
    agentId:
      voiceChatMeta?.agentId ??
      body.agentId ??
      url.searchParams.get("agentId") ??
      undefined,
    // Body only. Mentions carry every tool's description, and a workspace with
    // many selected tools put tens of kilobytes in the query string — rejected
    // at the edge with a 414 before the route could log anything.
    mentions: voiceChatMeta?.mentions ?? body.mentions ?? [],
  };
}

export const POST = withAuth(async (request, session) => {
  try {
    if (!isAiGatewayConfigured()) {
      return new Response(
        JSON.stringify({
          error:
            "AI Gateway is not configured. Set AI_GATEWAY_API_KEY (or VERCEL_AI_GATEWAY_API_KEY).",
        }),
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      sessionConfig?: {
        voice?: string;
        providerOptions?: {
          voiceChat?: {
            agentId?: string;
            mentions?: ChatMention[];
          };
        };
      };
      sessionOnly?: boolean;
      agentId?: string;
      mentions?: ChatMention[];
      /** Where the voice drawer was opened from; see VoiceSessionContext. */
      context?: unknown;
      /** The voice preset's default answer language; see VoiceLanguage. */
      language?: unknown;
    };

    const { agentId, mentions } = resolveVoiceRequestContext(request, body);
    // A closed set: anything else is ignored rather than trusted.
    const sessionContext = body.context === "cockpit" ? "cockpit" : undefined;
    const language = parseVoiceLanguage(body.language);

    const organizationId =
      (session.session as { activeOrganizationId?: string } | undefined)
        ?.activeOrganizationId ?? null;

    agentId && logger.info(`[${agentId}] Agent requested`);

    // Realtime tools are frozen at connect time, so whether this session can
    // drive a browser is decided once, here. The same answer feeds the prompt
    // and the tool list: telling the model about a tool it was not given is
    // how you get a promise it cannot keep.
    //
    // The reason is logged for the same reason the chat route logs its own:
    // several independent gates collapse into one absent tool, and without a
    // line naming the first one that failed, "why can't the voice agent
    // browse?" is only answerable by reading code.
    const browserSuppressedBy = await resolveVoiceBrowserSuppression({
      userId: session.user.id,
      organizationId,
    });
    const browserAutomation = browserSuppressedBy === null;
    if (browserSuppressedBy) {
      logger.info(`browser tools not offered: ${browserSuppressedBy}`);
    }

    const context = await buildVoiceAgentContext({
      actor: {
        userId: session.user.id,
        organizationId,
        source: "browser",
      },
      agentId,
      mentions,
      includeAppControl: true,
      defaultToAllMcpServers: true,
      browserAutomation,
      // The Tool Router hands back four meta-tools whatever the user has
      // connected, so the whole integration surface costs about what one app
      // tool does in a session config that is re-sent every turn.
      includeComposio: true,
      context: sessionContext,
      language,
    });

    context.agent && logger.info(`Agent: ${context.agent.name}`);

    const composioToolNames = Object.keys(context.composioTools);
    const toolSetup = buildOpenAIRealtimeToolSetup({
      mcpTools: context.mcpTools,
      composioTools: context.composioTools,
      requestedMentions: context.enabledMentions,
      includeAppTools: true,
      appToolCapabilities: { browserAutomation },
    });
    logger.info(
      `MCP tools requested=${toolSetup.toolStatus.requested.length}, available=${toolSetup.toolStatus.available.length}, unavailable=${toolSetup.toolStatus.unavailable.length}, composio=${composioToolNames.length} [${composioToolNames.join(", ")}]`,
    );

    const teamIdOrSlug = getAiGatewayTeamIdOrSlug();

    if (body.sessionOnly) {
      return Response.json({
        instructions: context.systemPrompt,
        // Only the prepare call: the transport's own token call is discarded.
        greeting: context.greeting,
        tools: toolSetup.tools,
        toolStatus: toolSetup.toolStatus,
        toolExecutionMap: toolSetup.toolExecutionMap,
        browserAutomation,
        teamIdOrSlug,
      });
    }

    const voiceGateway = getVoiceGateway();

    const { token, url } = await voiceGateway.experimental_realtime.getToken({
      model: VOICE_REALTIME_MODEL,
    });

    return Response.json({
      token,
      url,
      tools: toolSetup.tools,
      toolStatus: toolSetup.toolStatus,
      toolExecutionMap: toolSetup.toolExecutionMap,
      instructions: context.systemPrompt,
      browserAutomation,
      teamIdOrSlug,
    });
  } catch (error: unknown) {
    // The detail stays in the server log: a 500 body never carries internals.
    logger.error("Session setup failed:", error);
    return new Response(
      JSON.stringify({ error: "Failed to create voice session" }),
      { status: 500 },
    );
  }
});
