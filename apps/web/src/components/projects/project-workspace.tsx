"use client";

import { useProjectOverview } from "@/hooks/queries/use-project-overview";
import {
  isProjectRunActive,
  isProjectRunStale,
} from "@/lib/project-brain/run-status";
import { fetcher } from "@/lib/utils";
import {
  Brain,
  LayoutDashboard,
  RefreshCw,
  Settings,
  Share2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Button } from "ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { ProjectAccessAvatars } from "./project-access-avatars";
import { ProjectBrainTab } from "./project-brain-tab";
import { ProjectChatWrapper } from "./project-chat-wrapper";
import type { ProjectDocumentForGrid } from "./project-documents-grid";
import { ProjectOldChats } from "./project-old-chats";
import { ProjectOnboardingDrawer } from "./project-onboarding-drawer";
import { ProjectSettingsDialog } from "./project-settings-dialog";
import { ProjectStatusCard } from "./project-status-card";
import { ProjectTodosCard } from "./project-todos-card";

const ProjectKnowledgeGraph = dynamic(
  () =>
    import("./project-knowledge-graph").then(
      (module) => module.ProjectKnowledgeGraph,
    ),
  { ssr: false },
);

type ProjectWorkspaceProps = {
  project: {
    id: string;
    name: string;
    description: string | null;
    goal?: string | null;
    systemPrompt?: string | null;
    role?: "owner" | "editor" | "viewer";
    createdAt: string;
    retrievalProfileLabel: string;
  };
  initialDocuments: ProjectDocumentForGrid[];
};

export function ProjectWorkspace({
  project,
  initialDocuments,
}: ProjectWorkspaceProps) {
  const tRun = useTranslations("Projects.run");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab =
    tabParam === "brain" || tabParam === "graph" ? tabParam : "overview";
  const [threadId, setThreadId] = useState<string | null>(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    data: overview,
    isLoading: overviewLoading,
    mutate: mutateOverview,
    setTodoStatus,
  } = useProjectOverview(project.id);
  const [isSyncing, setIsSyncing] = useState(false);
  const { data: latestRun, mutate: mutateLatestRun } = useSWR<any>(
    `/api/projects/${project.id}/runs/latest`,
    fetcher,
    {
      // Stop polling once a run goes stale, otherwise an undelivered job keeps
      // the page requesting every 1.5s for as long as it stays open.
      refreshInterval: (run) => (isProjectRunActive(run) ? 1500 : 0),
    },
  );
  // Only a genuinely in-flight run should block a retry. A run stuck at
  // "queued" (background job never dispatched or never picked up) used to
  // disable this button forever, so clicking it did nothing at all.
  const runActive = isProjectRunActive(latestRun);
  const runStuck = isProjectRunStale(latestRun);

  // A run that just finished has rewritten the status and to-dos.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !runActive) void mutateOverview();
    wasActive.current = runActive;
  }, [runActive, mutateOverview]);

  useEffect(() => {
    if (searchParams.get("onboard") !== "1") return;
    setOnboardOpen(true);
    const next = new URLSearchParams(searchParams.toString());
    next.delete("onboard");
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  }, [pathname, router, searchParams]);

  const setTab = (nextTab: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (nextTab === "overview") next.delete("tab");
    else next.set("tab", nextTab);
    router.replace(next.toString() ? `${pathname}?${next}` : pathname, {
      scroll: false,
    });
  };

  const syncProject = async () => {
    setIsSyncing(true);
    try {
      const brain = (await fetcher(`/api/projects/${project.id}/brain`)) as {
        tools: Array<{ id: string; displayName: string; status: string }>;
      };
      const tools = brain.tools.filter((tool) => tool.status === "connected");
      if (!tools.length) {
        return toast.error("Attach a connector before syncing.");
      }
      // Sync every attached connector, not just the first one.
      const results = await Promise.allSettled(
        tools.map(async (tool) => {
          const response = await fetch(
            `/api/projects/${project.id}/tools/${tool.id}/sync`,
            {
              method: "POST",
              headers: { "Idempotency-Key": crypto.randomUUID() },
            },
          );
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(
              payload?.error?.message ?? `Could not sync ${tool.displayName}.`,
            );
          }
        }),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failed === results.length) {
        throw new Error("Could not start any sync.");
      }
      void mutateOverview();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start sync.",
      );
    } finally {
      setIsSyncing(false);
      // Pick up the new run (or the failure) without waiting for the poll.
      void mutateLatestRun();
    }
  };

  return (
    <div className="flex min-h-screen flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.goal ?? project.description}
          </p>
          {(runStuck || latestRun?.status === "failed") && (
            <p
              className="mt-1 text-xs text-muted-foreground"
              // The short cause helps an editor debug; viewers get the text only.
              title={
                project.role !== "viewer" && latestRun?.errorMessage
                  ? String(latestRun.errorMessage)
                  : undefined
              }
            >
              {runStuck
                ? tRun("stale")
                : tRun.has(`failed.${latestRun?.errorCode}`)
                  ? tRun(`failed.${latestRun?.errorCode}`)
                  : tRun("failedGeneric")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ProjectAccessAvatars projectId={project.id} role={project.role} />
          {project.role !== "viewer" && (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={syncProject}
                disabled={isSyncing || runActive}
              >
                <RefreshCw
                  className={`mr-2 size-4 ${
                    isSyncing || latestRun?.status === "running"
                      ? "animate-spin"
                      : ""
                  }`}
                />
                Sync now
              </Button>
            </>
          )}
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">
            <LayoutDashboard className="mr-2 size-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="brain">
            <Brain className="mr-2 size-4" />
            Brain
          </TabsTrigger>
          <TabsTrigger value="graph">
            <Share2 className="mr-2 size-4" />
            Graph
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <ProjectStatusCard
              projectId={project.id}
              status={overview?.status}
              connectorIssues={overview?.connectorIssues}
              isLoading={overviewLoading}
            />
            <ProjectTodosCard
              todos={overview?.todos}
              recentlyDone={overview?.recentlyDone}
              isLoading={overviewLoading}
              canEdit={project.role !== "viewer"}
              onSetStatus={setTodoStatus}
            />
          </div>
          <section className="rounded-xl border bg-card p-4">
            <ProjectChatWrapper
              projectId={project.id}
              projectName={project.name}
              selectedThreadId={threadId}
              onThreadCreated={setThreadId}
              stayInProject
            />
          </section>
          <ProjectOldChats projectId={project.id} selectedThreadId={threadId} />
        </TabsContent>
        <TabsContent value="brain">
          <ProjectBrainTab
            projectId={project.id}
            initialDocuments={initialDocuments}
            canEdit={project.role !== "viewer"}
          />
        </TabsContent>
        <TabsContent value="graph">
          {tab === "graph" && <ProjectKnowledgeGraph projectId={project.id} />}
        </TabsContent>
      </Tabs>

      <ProjectOnboardingDrawer
        open={onboardOpen}
        onOpenChange={setOnboardOpen}
        project={project}
      />
      <ProjectSettingsDialog
        project={project}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
    </div>
  );
}
