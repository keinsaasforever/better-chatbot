import { slugifyTitle } from "@/lib/project-brain/slug";

export function normalizeProjectId(projectId: string) {
  return projectId.trim().toLowerCase();
}

/** Stable, unique slug per project (Agentset max slug length: 48). */
export function buildProjectAgentsetSlug(projectId: string) {
  const id = normalizeProjectId(projectId);
  const slug = `project-${id}`;
  return slug.length <= 48 ? slug : `project-${id.replace(/-/g, "")}`;
}

/** Legacy slug used before we switched to full project IDs. */
export function buildLegacyProjectAgentsetSlug(
  projectId: string,
  projectName: string,
) {
  const id = normalizeProjectId(projectId);
  return `project-${slugifyTitle(projectName)}-${id.slice(0, 8)}`;
}

export function buildProjectAgentsetSlugCandidates(input: {
  projectId: string;
  projectName: string;
}) {
  return [
    buildProjectAgentsetSlug(input.projectId),
    buildLegacyProjectAgentsetSlug(input.projectId, input.projectName),
  ];
}

export function parseConflictSlugFromError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  const match = message.match(/slug "([^"]+)" is already in use/i);
  return match?.[1] ?? null;
}
