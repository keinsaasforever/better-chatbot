import { AgentCreateSchema } from "app-types/agent";
import { agentRepository } from "lib/db/repository";

export async function createAgentFromTranscript(input: {
  userId: string;
  organizationId?: string | null;
  name: string;
  description?: string;
  role?: string;
  systemPrompt: string;
  visibility?: "private" | "public" | "readonly";
}) {
  const data = AgentCreateSchema.parse({
    userId: input.userId,
    name: input.name,
    description: input.description,
    visibility: input.visibility ?? "private",
    instructions: {
      role: input.role,
      systemPrompt: input.systemPrompt,
      mentions: [],
    },
  });

  // organizationId is stamped separately: the create schema strips it (it is
  // server-derived from the voice actor, never client input).
  return agentRepository.insertAgent({
    ...data,
    organizationId: input.organizationId ?? null,
  });
}
