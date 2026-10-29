import Link from "next/link";
import { redirect } from "next/navigation";
import { FolderOpen, Plus } from "lucide-react";
import { getSession } from "auth/server";
import { and, desc, eq, or } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Button } from "ui/button";
import { pgDb } from "@/lib/db/pg/db.pg";
import { ProjectMemberTable, ProjectTable } from "@/lib/db/pg/schema.pg";
import { ProjectDialog } from "@/components/projects/project-dialog";

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/sign-in");

  const organizationId = (
    session.session as { activeOrganizationId?: string | null }
  ).activeOrganizationId;
  if (!organizationId) redirect("/");

  const projects = await pgDb
    .selectDistinct({ project: ProjectTable })
    .from(ProjectTable)
    .leftJoin(
      ProjectMemberTable,
      and(
        eq(ProjectMemberTable.projectId, ProjectTable.id),
        eq(ProjectMemberTable.userId, session.user.id),
      ),
    )
    .where(
      and(
        eq(ProjectTable.organizationId, organizationId),
        or(
          eq(ProjectTable.ownerUserId, session.user.id),
          eq(ProjectMemberTable.userId, session.user.id),
        ),
      ),
    )
    .orderBy(desc(ProjectTable.updatedAt));

  return (
    <main className="min-h-screen bg-background">
      <header className="flex items-center justify-between border-b px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="mt-1 text-muted-foreground">
            Shared project memory, documents, tools and knowledge graphs.
          </p>
        </div>
        <ProjectDialog>
          <Button className="gap-2">
            <Plus className="size-4" />
            New project
          </Button>
        </ProjectDialog>
      </header>

      <div className="px-4 py-6 sm:px-6">
        {projects.length ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map(({ project }) => (
              <Link key={project.id} href={`/projects/${project.id}`}>
                <Card className="h-full transition hover:border-primary/50 hover:shadow-md">
                  <CardHeader>
                    <CardTitle>{project.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
                      {project.goal ??
                        project.description ??
                        "No project goal yet."}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center py-16 text-center">
            <FolderOpen className="mb-4 size-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">No projects yet</h2>
            <p className="mt-1 text-muted-foreground">
              Create a project to begin building shared memory.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
