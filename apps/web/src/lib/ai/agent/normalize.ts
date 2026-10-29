import type { ChatMention } from "app-types/chat";
import type {
  Agent,
  AgentInstructionsSchema,
  AgentKnowledgeBaseBinding,
} from "app-types/agent";
import type { z } from "zod";

type AgentInstructions = z.infer<typeof AgentInstructionsSchema>;

/**
 * An agent's capabilities decomposed into eve-style named parts, instead of the
 * single `mentions` blob the DB stores today. This is the seam the codebase
 * reads an agent's definition through:
 *
 *   - `tools`  — callable capabilities (MCP tools/servers, default tools,
 *                workflows). eve's `tools/`.
 *   - `skills` — on-demand procedures hard-injected into the prompt. eve's
 *                `skills/`.
 *   - `instructions` — role + always-on system prompt. eve's `instructions.md`.
 *   - `knowledgeBases` — RAG bindings, re-validated at retrieval time.
 *
 * A future file/directory backend (mirroring `fb-mcp-config-storage.ts`) would
 * produce this SAME shape from `instructions.md` + `tools/` + `skills/`, so
 * every consumer stays backend-agnostic. Legacy `{ role, systemPrompt,
 * mentions, knowledgeBases }` rows read forward unchanged — there is no data
 * migration; this function is where the flat `mentions` array is split.
 */
export type AgentDefinition = {
  role?: string;
  systemPrompt?: string;
  tools: ChatMention[];
  skills: Extract<ChatMention, { type: "skill" }>[];
  knowledgeBases: AgentKnowledgeBaseBinding[];
};

/**
 * Normalizes an agent's stored `instructions` into an {@link AgentDefinition}.
 * Tolerant of `null`/`undefined`/partial rows so it is safe to call on any
 * agent record.
 */
export function normalizeAgentInstructions(
  instructions: AgentInstructions | null | undefined,
): AgentDefinition {
  const mentions = instructions?.mentions ?? [];
  const skills: Extract<ChatMention, { type: "skill" }>[] = [];
  const tools: ChatMention[] = [];

  for (const mention of mentions) {
    if (mention.type === "skill") {
      skills.push(mention);
    } else {
      // Agent mentions inside an agent's own tool list are not re-expanded at
      // chat time (nesting is resolved by the caller), but they are not tools
      // either; keep them out of the callable set.
      if (mention.type !== "agent") tools.push(mention);
    }
  }

  return {
    role: instructions?.role,
    systemPrompt: instructions?.systemPrompt,
    tools,
    skills,
    knowledgeBases: instructions?.knowledgeBases ?? [],
  };
}

/** Convenience: normalize straight from an agent record. */
export function normalizeAgent(agent: Agent): AgentDefinition {
  return normalizeAgentInstructions(agent.instructions);
}
