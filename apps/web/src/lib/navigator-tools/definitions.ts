import { COCKPIT_UPDATE_SEVERITIES } from "lib/cockpit/updates";
import { z } from "zod";
import type { NavigatorToolGroup, NavigatorToolSpec } from "./types";

/**
 * The Navigator tool catalog: names, descriptions, input schemas and flags.
 *
 * Client-safe on purpose (zod only). The voice drawer lists these tools, the
 * voice prompt describes them, and the server registry (`registry.ts`) pairs
 * each one with its `run`. One definition therefore serves the MCP endpoint,
 * the realtime voice session and the prompt that tells the model about them,
 * so the three cannot drift apart.
 *
 * Every description is re-sent with the realtime session config on every
 * spoken turn: keep them to one or two sentences (200 characters at most) and
 * keep the input schemas small.
 */

const agentReference = z
  .string()
  .min(1)
  .max(200)
  .describe("The agent's name or id, as the user referred to it.");

const agentVisibility = z.enum(["private", "readonly", "public"]);

const emptyInput = z.object({});

function spec<I extends z.ZodObject<z.ZodRawShape>>(
  definition: NavigatorToolSpec<I>,
): NavigatorToolSpec<I> {
  return definition;
}

// ── agents ────────────────────────────────────────────────────────────
export const listAgentsSpec = spec({
  name: "list_agents",
  group: "agents",
  description:
    "List the user's AI agents (id, name, description). The roster is also in your instructions; call this only to refresh it.",
  input: emptyInput,
  readOnly: true,
});

export const getAgentSpec = spec({
  name: "get_agent",
  group: "agents",
  description:
    "Get one agent's details: description, role, instructions and model. Name or id both work.",
  input: z.object({ agent: agentReference }),
  readOnly: true,
});

export const createAgentSpec = spec({
  name: "create_agent",
  group: "agents",
  description:
    "Create a new AI agent with a name, a role and instructions. Repeat the name and what it should do, and confirm before creating it.",
  input: z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000).optional(),
    role: z.string().max(200).optional(),
    instructions: z
      .string()
      .max(8000)
      .optional()
      .describe("The agent's system prompt: what it does and how."),
    visibility: agentVisibility.optional(),
  }),
  readOnly: false,
});

export const updateAgentSpec = spec({
  name: "update_agent",
  group: "agents",
  description:
    "Change an agent's name, description, role, instructions or visibility. Only the fields you pass change. Name or id both work.",
  input: z.object({
    agent: agentReference,
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(2000).optional(),
    role: z.string().max(200).optional(),
    instructions: z.string().max(8000).optional(),
    visibility: agentVisibility.optional(),
  }),
  readOnly: false,
  // Rare by voice and expensive to describe: kept for MCP clients only.
  voice: false,
});

export const runAgentSpec = spec({
  name: "run_agent",
  group: "agents",
  description:
    "Ask one of the user's agents a question or give it a task and get its answer back. It uses its own instructions and tools. Name or id both work.",
  input: z.object({
    agent: agentReference,
    question: z
      .string()
      .min(1)
      .max(2000)
      .describe(
        "What to ask, in full. The agent cannot hear the conversation, so include the context it needs.",
      ),
  }),
  // The agent has its own tools and may act on what it is asked.
  readOnly: false,
});

// ── chat ──────────────────────────────────────────────────────────────
export const createChatSpec = spec({
  name: "create_chat",
  group: "chat",
  description:
    "Start a new chat thread with a first message. An agent (name or id) can work on it in the background. Returns the threadId; the answer lands in that chat.",
  input: z.object({
    message: z.string().min(1).max(4000),
    agent: agentReference.optional(),
    projectName: z.string().max(200).optional(),
    title: z.string().max(80).optional(),
  }),
  readOnly: false,
});

export const sendChatMessageSpec = spec({
  name: "send_chat_message",
  group: "chat",
  description:
    "Send a message into a chat thread (a new one without threadId). With agentId the agent answers there in the background. Not for saving this conversation: it already is.",
  input: z.object({
    message: z.string().min(1).max(4000),
    threadId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    projectName: z.string().max(200).optional(),
    title: z.string().max(80).optional(),
  }),
  readOnly: false,
});

export const getChatReplySpec = spec({
  name: "get_chat_reply",
  group: "chat",
  description:
    "Read the latest assistant reply in a chat thread, e.g. what a background agent answered. Says when the answer is still pending.",
  input: z.object({ threadId: z.string().uuid() }),
  readOnly: true,
});

export const listRecentChatsSpec = spec({
  name: "list_recent_chats",
  group: "chat",
  description:
    "List the user's most recent chat threads (id, title, last activity).",
  input: z.object({
    limit: z.number().int().min(1).max(20).optional(),
  }),
  readOnly: true,
});

// ── projects ──────────────────────────────────────────────────────────
export const listProjectsSpec = spec({
  name: "list_projects",
  group: "projects",
  description:
    "List the user's projects (id, name, description). The roster is also in your instructions; call this only to refresh it.",
  input: emptyInput,
  readOnly: true,
});

export const createProjectSpec = spec({
  name: "create_project",
  group: "projects",
  description:
    "Create a project in the active organization with a name and optional description and goal. Confirm the name aloud first.",
  input: z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(500).optional(),
    goal: z.string().trim().max(4000).optional(),
  }),
  readOnly: false,
});

export const getProjectStatusSpec = spec({
  name: "get_project_status",
  group: "projects",
  description:
    "Get a project's current health, progress, open todos and recent events. Identify the project by projectId or projectName.",
  input: z.object({
    projectId: z.string().uuid().optional(),
    projectName: z.string().max(200).optional(),
  }),
  readOnly: true,
});

export const addProjectMemberSpec = spec({
  name: "add_project_member",
  group: "projects",
  description:
    "Add an organization member to a project. Confirm person, project and role aloud before calling.",
  input: z.object({
    projectName: z.string().min(1).max(200),
    memberNameOrEmail: z.string().min(1).max(200),
    role: z.enum(["viewer", "editor"]).default("editor"),
  }),
  readOnly: false,
});

// ── workflows ─────────────────────────────────────────────────────────
export const listWorkflowsSpec = spec({
  name: "list_workflows",
  group: "workflows",
  description:
    "List the workflows the user can see (id, name, description, published).",
  input: emptyInput,
  readOnly: true,
});

export const createWorkflowSpec = spec({
  name: "create_workflow",
  group: "workflows",
  description:
    "Create an empty workflow with a name and an optional description, ready to be built in the editor.",
  input: z.object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000).optional(),
  }),
  readOnly: false,
  // Voice drafts automations with generate_workflow instead.
  voice: false,
});

export const generateWorkflowSpec = spec({
  name: "generate_workflow",
  group: "workflows",
  description:
    "Draft an automation from a plain-language description of what should happen. Takes a little while; confirm the idea aloud before starting.",
  input: z.object({
    description: z.string().min(10).max(8000),
  }),
  readOnly: false,
});

export const executeWorkflowSpec = spec({
  name: "execute_workflow",
  group: "workflows",
  description:
    "Run a workflow (name or id) with optional input and wait up to 60 seconds for its result. Confirm before running.",
  input: z.object({
    workflow: z.string().min(1).max(200),
    input: z.record(z.string(), z.unknown()).optional(),
  }),
  readOnly: false,
});

// ── scheduled tasks ───────────────────────────────────────────────────
export const listScheduledTasksSpec = spec({
  name: "list_scheduled_tasks",
  group: "scheduled",
  description:
    "List the user's scheduled agent tasks with schedule, next run and last result.",
  input: emptyInput,
  readOnly: true,
});

export const createScheduledTaskSpec = spec({
  name: "create_scheduled_task",
  group: "scheduled",
  description:
    "Schedule an agent (name or id) to run on a cron schedule with a prompt. Repeat the schedule back in words and confirm before creating it.",
  input: z.object({
    agent: agentReference,
    cronExpression: z
      .string()
      .min(1)
      .max(100)
      .describe('Five-field cron, e.g. "0 8 * * 1-5" for weekdays at 8:00.'),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("IANA time zone; defaults to Europe/Berlin."),
    name: z.string().max(200).optional(),
    prompt: z.string().max(8000).optional(),
  }),
  readOnly: false,
});

export const runScheduledTaskSpec = spec({
  name: "run_scheduled_task",
  group: "scheduled",
  description:
    "Run one of the user's scheduled tasks now, in the background. The result lands in its chat.",
  input: z.object({ taskId: z.string().uuid() }),
  readOnly: false,
});

// ── skills ────────────────────────────────────────────────────────────
export const listSkillsSpec = spec({
  name: "list_skills",
  group: "skills",
  description: "List the skills in the user's library (name, description).",
  input: emptyInput,
  readOnly: true,
});

export const loadSkillSpec = spec({
  name: "load_skill",
  group: "skills",
  description:
    "Load a skill's instructions from the user's skill library into this conversation. Skill names are listed in your instructions.",
  input: z.object({ skillName: z.string().min(1).max(200) }),
  readOnly: true,
});

// ── cockpit ───────────────────────────────────────────────────────────
export const cockpitSummarySpec = spec({
  name: "cockpit_summary",
  group: "cockpit",
  description:
    "Business overview from the cockpit: finance, marketing, product health and SEO in compact numbers. Start here when asked how things are going.",
  input: emptyInput,
  readOnly: true,
});

export const cockpitFinanceSpec = spec({
  name: "cockpit_finance",
  group: "cockpit",
  description:
    "Cockpit finance feed: MRR, cash balances, inflow and outflow, payments and failed payments.",
  input: emptyInput,
  readOnly: true,
});

export const cockpitMarketingSpec = spec({
  name: "cockpit_marketing",
  group: "cockpit",
  description:
    "Cockpit marketing feed: website visitors, traffic sources and conversions.",
  input: emptyInput,
  readOnly: true,
});

export const cockpitProductHealthSpec = spec({
  name: "cockpit_product_health",
  group: "cockpit",
  description:
    "Cockpit product health feed: deployments, open incidents and errors per product.",
  input: emptyInput,
  readOnly: true,
});

export const cockpitSeoSpec = spec({
  name: "cockpit_seo",
  group: "cockpit",
  description:
    "Cockpit SEO feed: organic traffic estimate, keyword positions and referring domains.",
  input: emptyInput,
  readOnly: true,
});

/**
 * Only an in-app link (`/path`) or an https URL: the bell and the cockpit open
 * it, so a `javascript:` or protocol-relative value must never be stored.
 */
const updateUrl = z
  .string()
  .max(500)
  .refine(
    (value) => /^\/(?!\/)/.test(value) || /^https:\/\/[^\s]+$/.test(value),
    "url must be an in-app path starting with / or an https URL",
  );

export const cockpitPushUpdateSpec = spec({
  name: "cockpit_push_update",
  group: "cockpit",
  description:
    "Post a short line to the cockpit UPDATES display, e.g. after finishing a task that matters or spotting an anomaly.",
  input: z.object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(500).optional(),
    severity: z.enum(COCKPIT_UPDATE_SEVERITIES).default("info"),
    url: updateUrl.optional(),
  }),
  readOnly: false,
});

export const cockpitListUpdatesSpec = spec({
  name: "cockpit_list_updates",
  group: "cockpit",
  description: "List the latest updates on the cockpit UPDATES display.",
  input: z.object({
    limit: z.number().int().min(1).max(20).optional(),
  }),
  readOnly: true,
  // The cockpit shows these itself; voice has no need to read them back.
  voice: false,
});

/** Display order: groups as the prompt and the tools dropdown show them. */
export const NAVIGATOR_TOOL_GROUP_ORDER: NavigatorToolGroup[] = [
  "agents",
  "chat",
  "projects",
  "workflows",
  "scheduled",
  "skills",
  "cockpit",
];

export const NAVIGATOR_TOOL_SPECS: NavigatorToolSpec[] = [
  listAgentsSpec,
  getAgentSpec,
  createAgentSpec,
  updateAgentSpec,
  runAgentSpec,
  createChatSpec,
  sendChatMessageSpec,
  getChatReplySpec,
  listRecentChatsSpec,
  listProjectsSpec,
  createProjectSpec,
  getProjectStatusSpec,
  addProjectMemberSpec,
  listWorkflowsSpec,
  createWorkflowSpec,
  generateWorkflowSpec,
  executeWorkflowSpec,
  listScheduledTasksSpec,
  createScheduledTaskSpec,
  runScheduledTaskSpec,
  listSkillsSpec,
  loadSkillSpec,
  cockpitSummarySpec,
  cockpitFinanceSpec,
  cockpitMarketingSpec,
  cockpitProductHealthSpec,
  cockpitSeoSpec,
  cockpitPushUpdateSpec,
  cockpitListUpdatesSpec,
] as NavigatorToolSpec[];

const specsByName = new Map(NAVIGATOR_TOOL_SPECS.map((s) => [s.name, s]));

export function getNavigatorToolSpec(
  name: string,
): NavigatorToolSpec | undefined {
  return specsByName.get(name);
}

export function isNavigatorToolName(name: string): boolean {
  return specsByName.has(name);
}

export function isVoiceVisibleSpec(definition: NavigatorToolSpec): boolean {
  return definition.voice !== false;
}

/** Specs, optionally narrowed to the ones the realtime session is offered. */
export function listNavigatorToolSpecs(
  options: { voice?: boolean } = {},
): NavigatorToolSpec[] {
  if (options.voice === undefined) return NAVIGATOR_TOOL_SPECS;
  return NAVIGATOR_TOOL_SPECS.filter(
    (definition) => isVoiceVisibleSpec(definition) === options.voice,
  );
}
