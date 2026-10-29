import "server-only";
import { skillRepository } from "lib/db/repository";
import { listSkillsSpec, loadSkillSpec } from "../definitions";
import { trim } from "../shared";
import { NavigatorToolError, defineTool } from "../types";

const SKILL_CONTENT_LIMIT = 4000;

export const listSkillsTool = defineTool(listSkillsSpec, async (actor) => {
  const skills = await skillRepository.selectSkills(
    actor.userId,
    ["all"],
    50,
    actor.organizationId ?? undefined,
  );
  return {
    skills: skills.map((skill) => ({
      name: skill.name,
      description: trim(skill.description, 160),
    })),
  };
});

export const loadSkillTool = defineTool(loadSkillSpec, async (actor, args) => {
  const skills = await skillRepository.selectSkills(
    actor.userId,
    ["all"],
    50,
    actor.organizationId ?? undefined,
  );
  const needle = args.skillName.trim().toLowerCase();
  const summary =
    skills.find((skill) => skill.name.toLowerCase() === needle) ??
    skills.find((skill) => skill.slug.toLowerCase() === needle) ??
    skills.find((skill) => skill.name.toLowerCase().includes(needle));

  if (!summary) {
    return {
      found: false,
      note: "Kein passender Skill gefunden.",
      skills: skills.slice(0, 30).map((skill) => skill.name),
    };
  }

  const skill = await skillRepository.selectSkillById(
    summary.id,
    actor.userId,
    actor.organizationId,
  );
  if (!skill) {
    throw new NavigatorToolError("forbidden", "Skill not accessible");
  }

  return {
    skill: { name: skill.name, description: trim(skill.description, 200) },
    content: skill.content.slice(0, SKILL_CONTENT_LIMIT),
  };
});

export const SKILL_TOOLS = [listSkillsTool, loadSkillTool];
