import { skillRepository } from "lib/db/repository";
import { withAuth } from "auth/route-guard";
import { z } from "zod";
import { SkillQuerySchema, SkillSaveSchema } from "app-types/skill";
import {
  fetchSkillContent,
  SkillContentNotFoundError,
} from "lib/skills/fetch-skill-content";

function activeOrg(session: {
  session?: { activeOrganizationId?: string | null } | undefined;
}): string | null | undefined {
  return (
    session.session as { activeOrganizationId?: string | null } | undefined
  )?.activeOrganizationId;
}

export const GET = withAuth(async (request, session) => {
  try {
    const url = new URL(request.url);
    const { type, limit } = SkillQuerySchema.parse(
      Object.fromEntries(url.searchParams),
    );

    const skills = await skillRepository.selectSkills(
      session.user.id,
      [type],
      limit,
      activeOrg(session),
    );
    return Response.json(skills);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid query parameters", details: error.message },
        { status: 400 },
      );
    }
    console.error("Failed to fetch skills:", error);
    return new Response("Internal Server Error", { status: 500 });
  }
});

export const POST = withAuth(async (request, session) => {
  try {
    const body = await request.json();
    const data = SkillSaveSchema.parse(body);

    // Resolve + fetch the SKILL.md content server-side before persisting.
    let content: string;
    let fetchedDescription: string | undefined;
    try {
      const fetched = await fetchSkillContent(data.source, data.slug);
      content = fetched.content;
      fetchedDescription = fetched.description;
    } catch (error) {
      if (error instanceof SkillContentNotFoundError) {
        return Response.json(
          { error: "Could not import this skill — no SKILL.md found." },
          { status: 422 },
        );
      }
      throw error;
    }

    const skill = await skillRepository.insertSkill({
      name: data.name,
      // Frontmatter description feeds the Auto-mode catalog when the registry
      // result didn't carry one.
      description: data.description ?? fetchedDescription,
      slug: data.slug,
      source: data.source,
      content,
      icon: data.icon,
      visibility: data.visibility ?? "private",
      userId: session.user.id,
      organizationId: activeOrg(session) ?? null,
    });

    return Response.json(skill);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: "Invalid input", details: error.message },
        { status: 400 },
      );
    }
    console.error("Failed to save skill:", error);
    return Response.json({ message: "Internal Server Error" }, { status: 500 });
  }
});
