import { redirect } from "next/navigation";
import { getSession } from "auth/server";
import { getProjectDocuments } from "@/lib/ai/rag/search";
import { getAgentsetEmbeddingProfileOption } from "@/lib/agentset/embedding-profile-options";
import { requireProjectAccess } from "@/lib/projects/access";
import { ProjectWorkspace } from "@/components/projects/project-workspace";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/sign-in");

  const { id } = await params;
  let access;
  try {
    access = await requireProjectAccess({ projectId: id });
  } catch {
    redirect("/projects");
  }

  const profile = getAgentsetEmbeddingProfileOption(
    access.project.agentsetEmbeddingProfile,
  );
  const documents = await getProjectDocuments(
    access.project.id,
    access.project.ownerUserId,
  );

  return (
    <ProjectWorkspace
      project={{
        id: access.project.id,
        name: access.project.name,
        description: access.project.description,
        goal: access.project.goal,
        systemPrompt: access.project.systemPrompt,
        role: access.role,
        createdAt: access.project.createdAt.toISOString(),
        retrievalProfileLabel: `${profile.providerLabel} ${profile.modelLabel}`,
      }}
      initialDocuments={documents}
    />
  );
}
