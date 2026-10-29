import { tool as createTool } from "ai";
import { skillRepository } from "lib/db/repository";
import { safe } from "ts-safe";
import { z } from "zod";

export const LoadSkillToolName = "loadSkill";

/**
 * Progressive-disclosure tool for Auto mode: the model sees a catalog of skill
 * names + descriptions in the system prompt and calls this to pull a skill's
 * full instructions on demand. Org-scoped via the repository — a skill outside
 * the caller's ownership/active-org fails closed.
 */
export const createLoadSkillTool = (
  userId: string,
  activeOrganizationId?: string | null,
) =>
  createTool({
    description:
      "Load the full instructions for one of the available skills by its id. Call this when a skill from the Available Skills list is relevant to the user's request, then follow the returned instructions.",
    inputSchema: z.object({
      skillId: z.string().describe("The id of the skill to load"),
    }),
    execute: ({ skillId }) => {
      return safe(async () => {
        const skill = await skillRepository.selectSkillById(
          skillId,
          userId,
          activeOrganizationId,
        );
        if (!skill) {
          return {
            isError: true,
            error: "Skill not found or not accessible.",
          };
        }
        return {
          name: skill.name,
          description: skill.description,
          instructions: skill.content,
        };
      })
        .ifFail((e) => ({ isError: true, error: e.message }))
        .unwrap();
    },
  });
