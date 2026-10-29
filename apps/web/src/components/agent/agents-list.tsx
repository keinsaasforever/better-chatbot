"use client";

import { useTranslations } from "next-intl";
import { AgentSummary, AgentUpdateSchema } from "app-types/agent";
import { Card, CardDescription, CardHeader, CardTitle } from "ui/card";
import { Button } from "ui/button";
import { Plus, ArrowUpRight, Library } from "lucide-react";
import Link from "next/link";
import { BackgroundPaths } from "ui/background-paths";
import { useBookmark } from "@/hooks/queries/use-bookmark";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { toast } from "sonner";
import useSWR from "swr";
import { fetcher } from "lib/utils";
import { Visibility } from "@/components/shareable-actions";
import { ShareableCard } from "@/components/shareable-card";
import { ScheduleStatusBadge } from "@/components/scheduled-tasks/schedule-status-badge";
import { useScheduledTasks } from "@/hooks/queries/use-scheduled-tasks";
import { AgentLibraryDrawer } from "@/components/agent/agent-library-drawer";
import { notify } from "lib/notify";
import { useState } from "react";
import { handleErrorWithToast } from "ui/shared-toast";
import { safe } from "ts-safe";
import { canCreateAgent } from "lib/auth/client-permissions";
import { analytics } from "@/lib/analytics/posthog";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";

interface AgentsListProps {
  initialMyAgents: AgentSummary[];
  initialSharedAgents: AgentSummary[];
  userId: string;
  userRole?: string | null;
}

export function AgentsList({
  initialMyAgents,
  initialSharedAgents,
  userId,
  userRole,
}: AgentsListProps) {
  const t = useTranslations();
  const mutateAgents = useMutateAgents();
  const [deletingAgentLoading, setDeletingAgentLoading] = useState<
    string | null
  >(null);
  const [visibilityChangeLoading, setVisibilityChangeLoading] = useState<
    string | null
  >(null);

  const { data: allAgents } = useSWR(
    "/api/agent?filters=mine,shared",
    fetcher,
    {
      fallbackData: [...initialMyAgents, ...initialSharedAgents],
    },
  );

  const myAgents =
    allAgents?.filter((agent: AgentSummary) => agent.userId === userId) ||
    initialMyAgents;

  const sharedAgents =
    allAgents?.filter((agent: AgentSummary) => agent.userId !== userId) ||
    initialSharedAgents;

  const { toggleBookmark: toggleBookmarkHook, isLoading: isBookmarkLoading } =
    useBookmark({
      itemType: "agent",
    });

  const { byAgentId: scheduleByAgentId } = useScheduledTasks();

  const toggleBookmark = async (agentId: string, isBookmarked: boolean) => {
    await toggleBookmarkHook({ id: agentId, isBookmarked });
  };

  const updateVisibility = async (agentId: string, visibility: Visibility) => {
    // Find current agent to get old visibility
    const currentAgent = allAgents?.find((a: AgentSummary) => a.id === agentId);
    const oldVisibility = currentAgent?.visibility;

    safe(() => setVisibilityChangeLoading(agentId))
      .map(() => AgentUpdateSchema.parse({ visibility }))
      .map(JSON.stringify)
      .map(async (body) =>
        fetcher(`/api/agent/${agentId}`, {
          method: "PUT",
          body,
        }),
      )
      .ifOk(() => {
        mutateAgents({ id: agentId, visibility });

        // Track visibility change
        if (oldVisibility) {
          analytics.agentVisibilityChanged({
            agentId,
            oldVisibility,
            newVisibility: visibility,
          });
        }
      })
      .ifFail((e) => {
        handleErrorWithToast(e);
        toast.error(t("Common.error"));
      })
      .watch(() => setVisibilityChangeLoading(null));
  };

  const deleteAgent = async (agentId: string) => {
    // Find agent to get name for tracking
    const agentToDelete = allAgents?.find(
      (a: AgentSummary) => a.id === agentId,
    );

    const ok = await notify.confirm({
      description: t("Agent.deleteConfirm"),
    });
    if (!ok) return;
    safe(() => setDeletingAgentLoading(agentId))
      .map(() =>
        fetcher(`/api/agent/${agentId}`, {
          method: "DELETE",
        }),
      )
      .ifOk(() => {
        mutateAgents({ id: agentId }, true);

        // Track agent deletion
        analytics.agentDeleted({
          agentId,
          name: agentToDelete?.name,
        });
      })
      .ifFail((e) => {
        handleErrorWithToast(e);
        toast.error(t("Common.error"));
      })
      .watch(() => setDeletingAgentLoading(null));
  };

  // Check if user can create agents using Better Auth permissions
  const canCreate = canCreateAgent(userRole);
  const appStoreMutate = appStore(useShallow((state) => state.mutate));

  return (
    <div className="w-full flex flex-col gap-4 p-8">
      <AgentLibraryDrawer />

      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold" data-testid="agents-title">
          {t("Layout.agents")}
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => appStoreMutate({ openAgentLibrary: true })}
          >
            <Library className="size-4" />
            Agent Library
          </Button>
          {canCreate && (
            <Link href="/agent/new">
              <Button variant="ghost" data-testid="create-agent-button">
                <Plus />
                {t("Agent.newAgent")}
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* My Agents Section */}
      {canCreate && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{t("Agent.myAgents")}</h2>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {canCreate && (
              <Link href="/agent/new">
                <Card
                  className="relative bg-secondary overflow-hidden cursor-pointer hover:bg-input transition-colors h-[196px]"
                  data-testid="create-agent-card"
                >
                  <div className="absolute inset-0 w-full h-full opacity-50">
                    <BackgroundPaths />
                  </div>
                  <CardHeader>
                    <CardTitle>
                      <h1 className="text-lg font-bold">
                        {t("Agent.newAgent")}
                      </h1>
                    </CardTitle>
                    <CardDescription className="mt-2">
                      <p>{t("Layout.createYourOwnAgent")}</p>
                    </CardDescription>
                    <div className="mt-auto ml-auto flex-1">
                      <Button variant="ghost" size="lg">
                        {t("Common.create")}
                        <ArrowUpRight className="size-3.5" />
                      </Button>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            )}

            {myAgents.map((agent) => {
              const schedule = scheduleByAgentId.get(agent.id);
              return (
                <ShareableCard
                  key={agent.id}
                  type="agent"
                  item={agent}
                  href={`/agent/${agent.id}`}
                  onVisibilityChange={updateVisibility}
                  isVisibilityChangeLoading={
                    visibilityChangeLoading === agent.id
                  }
                  isDeleteLoading={deletingAgentLoading === agent.id}
                  onDelete={deleteAgent}
                  headerMeta={
                    schedule ? (
                      <ScheduleStatusBadge
                        task={schedule}
                        className="min-w-0 truncate"
                      />
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Shared/Available Agents Section */}
      <div className="flex flex-col gap-4 mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            {canCreate ? t("Agent.sharedAgents") : t("Agent.availableAgents")}
          </h2>
          <div className="flex-1 h-px bg-border" />
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sharedAgents.map((agent) => (
            <ShareableCard
              key={agent.id}
              type="agent"
              item={agent}
              isOwner={false}
              href={`/agent/${agent.id}`}
              onBookmarkToggle={toggleBookmark}
              isBookmarkToggleLoading={isBookmarkLoading(agent.id)}
            />
          ))}
          {sharedAgents.length === 0 && (
            <Card className="col-span-full bg-transparent border-none">
              <CardHeader className="text-center py-12">
                <CardTitle>
                  {canCreate
                    ? t("Agent.noSharedAgents")
                    : t("Agent.noAvailableAgents")}
                </CardTitle>
                <CardDescription>
                  {canCreate
                    ? t("Agent.noSharedAgentsDescription")
                    : t("Agent.noAvailableAgentsDescription")}
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
