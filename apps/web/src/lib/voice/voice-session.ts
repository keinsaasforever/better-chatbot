import { Agent } from "app-types/agent";
import { ChatMention } from "app-types/chat";
import {
  filterMcpServerCustomizations,
  loadMcpToolsStateless,
  mergeSystemPrompt,
} from "@/app/api/chat/shared.chat";
import {
  buildCockpitGreetingPrompt,
  buildCockpitOversightPrompt,
  buildMcpServerCustomizationsSystemPrompt,
  buildSpeechSystemPrompt,
  buildVoiceAppControlPrompt,
} from "lib/ai/prompts";
import {
  agentRepository,
  skillRepository,
  userRepository,
} from "lib/db/repository";
import type { VoiceLanguage } from "lib/ai/speech/voice-realtime-config";
import { getUserPreferences } from "lib/user/server";
import { safe } from "ts-safe";
import {
  rememberAgentAction,
  rememberMcpServerCustomizationsAction,
} from "@/app/api/chat/actions";
import { VoiceActor } from "./types";

export type VoiceSessionContext = "cockpit";

export type VoiceAgentContext = {
  agent?: Agent;
  enabledMentions: ChatMention[];
  mcpTools: Awaited<ReturnType<typeof loadMcpToolsStateless>>;
  /**
   * Composio's Tool Router meta-tools, or `{}` when the user has nothing
   * connected. Four schemas at most whatever the number of connected apps, so
   * unlike a per-action toolset these are affordable in a realtime session.
   */
  composioTools: Record<string, unknown>;
  systemPrompt: string;
  /**
   * Instructions for an opening response the model speaks before the user
   * says anything. Only cockpit sessions have one.
   */
  greeting?: string;
};

/**
 * Returns true only when the mention list explicitly references an MCP tool or
 * server. Used to skip the per-server connect+introspect round-trip on plain
 * voice commands that don't need MCP (the common case).
 */
function hasMcpMentions(mentions: ChatMention[]): boolean {
  return mentions.some((m) => m.type === "mcpTool" || m.type === "mcpServer");
}

/** Roster caps: every entry is re-billed with the session config per turn. */
const APP_CONTROL_AGENT_LIMIT = 20;
const APP_CONTROL_SKILL_LIMIT = 30;

/**
 * Budget for the implicit "load every server" fallback. Unreachable servers
 * each burn the full MCP introspection timeout (8s), which would otherwise be
 * spent before the caller can even open the microphone. Explicit mentions are
 * not capped this way — there the user asked for those tools specifically.
 */
const DEFAULT_MCP_LOAD_DEADLINE_MS = 2500;

/**
 * Budget for the Composio Tool Router lookup.
 *
 * Same reasoning as the MCP deadline: this runs before the microphone opens,
 * and it reaches Composio over the network. Losing the integration tools is a
 * far smaller failure than a voice session that will not start.
 */
const COMPOSIO_LOAD_DEADLINE_MS = 2500;

/** Resolves to `fallback` when `promise` misses the deadline. */
function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T = {} as T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * The user's Composio Tool Router meta-tools, or `{}` on any failure.
 *
 * `shared.chat` is a barrel that reaches the workflow executor and every chat
 * tool, so it is imported dynamically: the device transcript path shares this
 * module and has no use for that graph.
 */
async function loadComposioMetaTools(
  userId: string,
): Promise<Record<string, unknown>> {
  try {
    const { loadComposioTools } = await import("@/app/api/chat/shared.chat");
    return await loadComposioTools(userId);
  } catch {
    return {};
  }
}

/**
 * The agent and skill rosters the app-control prompt names.
 *
 * Split from prompt building so it can run in the same `Promise.all` as the
 * Composio lookup: the prompt needs the Composio tool names, but the rosters do
 * not, and serializing two network round trips before the microphone opens is
 * exactly what the deadlines below exist to avoid.
 */
async function loadAppControlRoster(actor: VoiceActor) {
  const [agents, skills] = await Promise.all([
    agentRepository
      .selectAgents(
        actor.userId,
        ["all"],
        APP_CONTROL_AGENT_LIMIT,
        actor.organizationId ?? undefined,
      )
      .catch(() => []),
    skillRepository
      .selectSkills(
        actor.userId,
        ["all"],
        APP_CONTROL_SKILL_LIMIT,
        actor.organizationId ?? undefined,
      )
      .catch(() => []),
  ]);
  return {
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description?.slice(0, 120),
    })),
    skills: skills.map((skill) => skill.name),
  };
}

export async function buildVoiceAgentContext({
  actor,
  agentId,
  mentions,
  includeAppControl = false,
  defaultToAllMcpServers = false,
  browserAutomation = false,
  includeComposio = false,
  context,
  language,
}: {
  actor: VoiceActor;
  /**
   * The session's default answer language (see VoiceLanguage). Callers that
   * have no voice preset leave it out and get German.
   */
  language?: VoiceLanguage;
  /**
   * Where the session was opened from. `"cockpit"` appends the oversight
   * prompt that makes the model the owner's flight-deck copilot.
   */
  context?: VoiceSessionContext;
  agentId?: string;
  mentions: ChatMention[];
  includeAppControl?: boolean;
  /**
   * Whether this session is offered the browser tools. Only affects the
   * prompt — the tool list is filtered separately in
   * `buildOpenAIRealtimeToolSetup` — but the two must be given the same answer,
   * or the model is told about a tool it does not have.
   */
  browserAutomation?: boolean;
  /**
   * When the caller sent no MCP mentions and no agent pinned any, load every
   * MCP server the user can reach instead of none. The browser voice UI has no
   * tool picker of its own, and its server list arrives over a slow SWR fetch
   * that is often still empty when the session is prepared — deriving the
   * default here reads straight from the DB and cannot lose that race.
   */
  defaultToAllMcpServers?: boolean;
  /**
   * Load the user's Composio Tool Router meta-tools. Browser voice only: the
   * device transcript path builds its own tool set and loads Composio itself.
   */
  includeComposio?: boolean;
}): Promise<VoiceAgentContext> {
  const user = await userRepository.getUserById(actor.userId);
  if (!user) {
    throw new Error("User not found");
  }

  const agent = await rememberAgentAction(
    agentId,
    actor.userId,
    actor.organizationId,
  );
  const enabledMentions = agent?.instructions.mentions ?? mentions;

  // Only introspect MCP servers when the command or agent instructions
  // explicitly mention an MCP tool/server. Connecting to every server on every
  // voice command is the main latency and reliability risk under load.
  // With explicit mentions, load exactly those. Without them, either fall back
  // to the user's full server set (browser voice) or skip MCP entirely (device
  // commands, where the connect+introspect round-trip is the latency risk).
  const mcpTools = hasMcpMentions(enabledMentions)
    ? await loadMcpToolsStateless(actor.userId, {
        mentions: enabledMentions,
        organizationId: actor.organizationId,
      })
    : defaultToAllMcpServers
      ? await withDeadline(
          loadMcpToolsStateless(actor.userId, {
            organizationId: actor.organizationId,
            includeAllServers: true,
          }).catch(() => ({})),
          DEFAULT_MCP_LOAD_DEADLINE_MS,
        )
      : {};

  const [userPreferences, appControlRoster, composioTools] = await Promise.all([
    getUserPreferences(actor.userId),
    includeAppControl ? loadAppControlRoster(actor) : Promise.resolve(null),
    // Only the browser session: the device transcript path runs its own agent
    // and loads Composio itself. Deadlined like MCP because this reaches
    // Composio over the network before the microphone can open, and a slow
    // integration must not hold the session shut.
    includeComposio
      ? withDeadline(
          loadComposioMetaTools(actor.userId),
          COMPOSIO_LOAD_DEADLINE_MS,
          {} as Record<string, unknown>,
        )
      : Promise.resolve({} as Record<string, unknown>),
  ]);

  // Built here, not inside the roster load, so the prompt can name the Composio
  // tools the session was actually given. The tool list is filtered separately
  // in `buildOpenAIRealtimeToolSetup`; both must be told the same thing.
  const appControlPrompt = appControlRoster
    ? buildVoiceAppControlPrompt({
        ...appControlRoster,
        browserAutomation,
        composioTools: Object.keys(composioTools),
      })
    : "";

  const mcpServerCustomizations = await safe()
    .map(() => {
      if (Object.keys(mcpTools).length === 0) throw new Error("No tools found");
      return rememberMcpServerCustomizationsAction(actor.userId);
    })
    .map((value) => filterMcpServerCustomizations(mcpTools, value))
    .orElse({});

  const systemPrompt = mergeSystemPrompt(
    buildSpeechSystemPrompt(user, userPreferences ?? undefined, agent, {
      language,
    }),
    appControlPrompt,
    // Only next to the app tools: the oversight rules name cockpit tools.
    context === "cockpit" && appControlRoster
      ? buildCockpitOversightPrompt()
      : "",
    buildMcpServerCustomizationsSystemPrompt(mcpServerCustomizations),
  );

  return {
    agent: agent ?? undefined,
    enabledMentions,
    mcpTools,
    composioTools,
    systemPrompt,
    greeting:
      context === "cockpit"
        ? buildCockpitGreetingPrompt(user, userPreferences ?? undefined)
        : undefined,
  };
}
