"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import { useWorkflowToolList } from "@/hooks/queries/use-workflow-tool-list";
import { useSkills } from "@/hooks/queries/use-skills";
import { useAgentSchedules } from "@/hooks/queries/use-scheduled-tasks";
import { useObjectState } from "@/hooks/use-object-state";
import { useBookmark } from "@/hooks/queries/use-bookmark";
import { Agent, AgentCreateSchema, AgentUpdateSchema } from "app-types/agent";
import { ChatMention } from "app-types/chat";
import { MCPServerInfo } from "app-types/mcp";
import { WorkflowSummary } from "app-types/workflow";
import { BACKGROUND_COLORS } from "lib/const";
import { defaultToolMentionsFromNames } from "lib/ai/agent/default-tool-mentions";
import { cn, fetcher, objectFlow } from "lib/utils";
import { safe } from "ts-safe";
import { handleErrorWithToast } from "ui/shared-toast";
import { ChevronDown, Loader, Library, WandSparklesIcon } from "lucide-react";
import { analytics } from "@/lib/analytics/posthog";
import { Button } from "ui/button";
import { appStore } from "@/app/store";
import { useShallow } from "zustand/shallow";
import { AgentLibraryDrawer } from "./agent-library-drawer";
import { Input } from "ui/input";
import { Label } from "ui/label";
import { Textarea } from "ui/textarea";
import { ScrollArea } from "ui/scroll-area";
import { Skeleton } from "ui/skeleton";
import { TextShimmer } from "ui/text-shimmer";
import { ShareableActions, Visibility } from "@/components/shareable-actions";
import { GenerateAgentDialog } from "./generate-agent-dialog";
import { AgentIconPicker } from "./agent-icon-picker";
import { AgentToolSelector } from "./agent-tool-selector";
import { notify } from "lib/notify";
import { ScheduleButton } from "@/components/scheduled-tasks/schedule-button";
import type { DeferredScheduleConfig } from "@/components/scheduled-tasks/schedule-dialog";
import { ScheduleStatus } from "@/components/scheduled-tasks/schedule-status";
import { SelectModel } from "@/components/select-model";
import { formatAgentModel, parseAgentModel } from "@/lib/ai/agent-model";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { useKnowledgeBases } from "@/hooks/queries/use-knowledge-bases";
import type { AgentKnowledgeBaseBinding } from "app-types/agent";

const defaultConfig = (): PartialBy<
  Omit<Agent, "createdAt" | "updatedAt" | "userId">,
  "id"
> => {
  return {
    name: "",
    description: "",
    icon: {
      type: "emoji",
      value:
        "https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f916.png",
      style: {
        backgroundColor: BACKGROUND_COLORS[0],
      },
    },
    instructions: {
      role: "",
      systemPrompt: "",
      mentions: [],
    },
    visibility: "private",
    model: null,
  };
};

function LibraryButton() {
  const appStoreMutate = appStore(useShallow((state) => state.mutate));
  return (
    <>
      <AgentLibraryDrawer />
      <Button
        variant="outline"
        onClick={() => appStoreMutate({ openAgentLibrary: true })}
        data-testid="agent-browse-library-button"
      >
        <Library className="size-3" />
        Browse library
      </Button>
    </>
  );
}

function AgentKnowledgeBaseSelector({
  bindings,
  disabled,
  onChange,
}: {
  bindings: AgentKnowledgeBaseBinding[];
  disabled?: boolean;
  onChange: (bindings: AgentKnowledgeBaseBinding[]) => void;
}) {
  const { knowledgeBases, projects, isLoading } = useKnowledgeBases();

  const toggle = (binding: AgentKnowledgeBaseBinding, checked: boolean) => {
    onChange(
      checked
        ? [...bindings.filter((b) => b.id !== binding.id), binding]
        : bindings.filter((b) => b.id !== binding.id),
    );
  };
  const isBound = (id: string) => bindings.some((b) => b.id === id);

  const label = bindings.length
    ? bindings.map((b) => b.name || "Untitled").join(", ")
    : "None — add a knowledge base";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="secondary"
          className="bg-secondary/40 max-w-full justify-start data-[state=open]:bg-input! hover:bg-input!"
          disabled={disabled || isLoading}
          data-testid="agent-knowledge-base-select-button"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-auto size-3.5 opacity-60 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {knowledgeBases.length === 0 && projects.length === 0 && (
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            No knowledge bases yet — upload one from the chat&apos;s + menu.
          </DropdownMenuLabel>
        )}
        {knowledgeBases.length > 0 && (
          <>
            <DropdownMenuLabel>Knowledge bases</DropdownMenuLabel>
            {knowledgeBases.map((kb) => (
              <DropdownMenuCheckboxItem
                key={kb.id}
                checked={isBound(kb.id)}
                onCheckedChange={(checked) =>
                  toggle({ type: "kb", id: kb.id, name: kb.name }, !!checked)
                }
                onSelect={(e) => e.preventDefault()}
              >
                {kb.name}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
        {projects.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {projects.map((project) => (
              <DropdownMenuCheckboxItem
                key={project.id}
                checked={isBound(project.id)}
                onCheckedChange={(checked) =>
                  toggle(
                    { type: "project", id: project.id, name: project.name },
                    !!checked,
                  )
                }
                onSelect={(e) => e.preventDefault()}
              >
                {project.name}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface EditAgentProps {
  initialAgent?: Agent;
  userId: string;
  isOwner?: boolean;
  hasEditAccess?: boolean;
  isBookmarked?: boolean;
}

export default function EditAgent({
  initialAgent,
  userId,
  isOwner = true,
  hasEditAccess = true,
}: EditAgentProps) {
  const t = useTranslations();
  const mutateAgents = useMutateAgents();
  const router = useRouter();

  const [openGenerateAgentDialog, setOpenGenerateAgentDialog] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVisibilityChangeLoading, setIsVisibilityChangeLoading] =
    useState(false);
  // Schedule configured during creation, saved right after the agent is.
  const [pendingSchedule, setPendingSchedule] =
    useState<DeferredScheduleConfig | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Initialize agent state with initial data or defaults
  const [agent, setAgent] = useObjectState(initialAgent || defaultConfig());

  const { toggleBookmark, isLoading: isBookmarkToggleLoadingFn } = useBookmark({
    itemType: "agent",
  });
  const isBookmarkToggleLoading = useMemo(
    () =>
      (initialAgent?.id && isBookmarkToggleLoadingFn(initialAgent?.id)) ||
      false,
    [initialAgent?.id, isBookmarkToggleLoadingFn],
  );

  const { data: mcpList, isLoading: isMcpLoading } = useMcpList();
  const { data: workflowToolList, isLoading: isWorkflowLoading } =
    useWorkflowToolList();
  // Populate the store's skillList so skills are attachable in the tool picker.
  useSkills();

  // All schedules for this agent, scoped by the server's ?agentId= filter. The
  // previous raw fetches took tasks[0] from an UNFILTERED list, so an agent's
  // page could show a different agent's schedule.
  const {
    schedules,
    isLoading: isLoadingSchedule,
    mutate: refetchSchedule,
  } = useAgentSchedules(initialAgent?.id);

  // A key for the next NEW schedule that won't collide with existing ones.
  const nextScheduleKey = useMemo(() => {
    const used = new Set(schedules.map((s) => s.key));
    if (!used.has("default")) return "default";
    let i = 2;
    while (used.has(`schedule-${i}`)) i++;
    return `schedule-${i}`;
  }, [schedules]);

  const assignToolsByNames = useCallback(
    (toolNames: string[]) => {
      const allMentions: ChatMention[] = [
        ...defaultToolMentionsFromNames(toolNames),
      ];

      (mcpList as (MCPServerInfo & { id: string })[])?.forEach((mcp) => {
        mcp.toolInfo.forEach((tool) => {
          if (toolNames.includes(tool.name)) {
            allMentions.push({
              type: "mcpTool",
              serverName: mcp.name,
              name: tool.name,
              serverId: mcp.id,
            });
          }
        });
      });

      (workflowToolList as WorkflowSummary[])?.forEach((workflow) => {
        if (toolNames.includes(workflow.name)) {
          allMentions.push({
            type: "workflow",
            name: workflow.name,
            workflowId: workflow.id,
          });
        }
      });

      // Always write the resolved set, even when it is empty. The old guard
      // skipped the update whenever nothing matched, which left the previous
      // mentions in place and made a generation that resolved to nothing look
      // like it had worked — the tools appeared in the proposal, the agent
      // saved, and none of them were attached.
      setAgent((prev) => ({
        instructions: {
          ...prev.instructions,
          mentions: allMentions,
        },
      }));

      // Names the generator proposed that match nothing this workspace has.
      // Composio toolkits are the common case: they are reached through
      // /api/connections and are in none of the three sources above, so a
      // generated Composio tool silently resolves to nothing.
      const resolved = new Set(allMentions.map((mention) => mention.name));
      const unresolved = toolNames.filter((name) => !resolved.has(name));
      if (unresolved.length > 0) {
        toast.error(
          t("Agent.toolsNotAvailable", { tools: unresolved.join(", ") }),
        );
      }
    },
    [mcpList, workflowToolList, setAgent, t],
  );

  const saveAgent = useCallback(() => {
    if (initialAgent) {
      safe(() => setIsSaving(true))
        .map(() => AgentUpdateSchema.parse({ ...agent }))
        .map(JSON.stringify)
        .map(async (body) =>
          fetcher(`/api/agent/${initialAgent.id}`, {
            method: "PUT",
            body,
          }),
        )
        .ifOk((updatedAgent) => {
          mutateAgents(updatedAgent);
          router.push(`/agents`);
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    } else {
      safe(() => setIsSaving(true))
        .map(() => AgentCreateSchema.parse({ ...agent, userId }))
        .map(JSON.stringify)
        .map(async (body) => {
          return fetcher(`/api/agent`, {
            method: "POST",
            body,
          });
        })
        .ifOk(async (updatedAgent) => {
          mutateAgents(updatedAgent);

          // Track agent creation
          analytics.agentCreated({
            agentId: updatedAgent.id,
            name: updatedAgent.name,
            visibility: updatedAgent.visibility,
            toolsCount: updatedAgent.instructions?.mentions?.length || 0,
          });

          // Save a schedule configured during creation now that the agent
          // exists. A failure keeps the agent and lands on its edit page so
          // the user can retry the schedule there.
          if (pendingSchedule) {
            const response = await fetch("/api/scheduled-tasks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                taskType: "agent",
                agentId: updatedAgent.id,
                ...pendingSchedule,
              }),
            }).catch(() => null);
            if (!response?.ok) {
              toast.error(
                "Agent created, but the schedule could not be saved. Please add it again.",
              );
              router.push(`/agent/${updatedAgent.id}`);
              return;
            }
          }

          router.push(`/agents`);
        })
        .ifFail(handleErrorWithToast)
        .watch(() => setIsSaving(false));
    }
  }, [agent, userId, mutateAgents, router, initialAgent, t, pendingSchedule]);

  const updateVisibility = useCallback(
    async (visibility: Visibility) => {
      if (initialAgent?.id) {
        const oldVisibility = agent.visibility;
        safe(() => setIsVisibilityChangeLoading(true))
          .map(() => AgentUpdateSchema.parse({ visibility }))
          .map(JSON.stringify)
          .map(async (body) =>
            fetcher(`/api/agent/${initialAgent.id}`, {
              method: "PUT",
              body,
            }),
          )
          .ifOk(() => {
            setAgent({ visibility });
            mutateAgents({ id: initialAgent.id, visibility });

            // Track visibility change
            analytics.agentVisibilityChanged({
              agentId: initialAgent.id,
              oldVisibility,
              newVisibility: visibility,
            });
          })
          .ifFail(handleErrorWithToast)
          .watch(() => setIsVisibilityChangeLoading(false));
      } else {
        setAgent({ visibility });
      }
    },
    [
      initialAgent?.id,
      mutateAgents,
      setAgent,
      setIsVisibilityChangeLoading,
      t,
      agent.visibility,
    ],
  );

  const deleteAgent = useCallback(async () => {
    if (!initialAgent?.id) return;
    const ok = await notify.confirm({
      description: t("Agent.deleteConfirm"),
    });
    if (!ok) return;
    safe(() => setIsSaving(true))
      .map(() =>
        fetcher(`/api/agent/${initialAgent.id}`, {
          method: "DELETE",
        }),
      )
      .ifOk(() => {
        mutateAgents({ id: initialAgent.id }, true);

        // Track agent deletion
        analytics.agentDeleted({
          agentId: initialAgent.id,
          name: agent.name,
        });

        router.push("/agents");
      })
      .ifFail(handleErrorWithToast)
      .watch(() => setIsSaving(false));
  }, [initialAgent?.id, mutateAgents, router, t, agent.name]);

  const handleBookmarkToggle = useCallback(async () => {
    if (!initialAgent?.id || isBookmarkToggleLoading) return;
    safe(async () => {
      await toggleBookmark({
        id: initialAgent.id,
        isBookmarked: agent.isBookmarked,
      });
    })
      .ifOk(() => {
        setAgent({ isBookmarked: !agent.isBookmarked });
      })
      .ifFail(handleErrorWithToast);
  }, [
    initialAgent?.id,
    toggleBookmark,
    agent.isBookmarked,
    isBookmarkToggleLoading,
  ]);

  const handleAgentChange = useCallback((generatedData: any) => {
    if (textareaRef.current) {
      textareaRef.current.scrollTo({
        top: textareaRef.current.scrollHeight,
      });
    }
    setAgent((prev) => {
      const update: Partial<Agent> = {};
      objectFlow(generatedData).forEach((data, key) => {
        if (key === "name") {
          update.name = data as string;
        }
        if (key === "description") {
          update.description = data as string;
        }
        if (key === "instructions") {
          update.instructions = {
            ...prev.instructions,
            systemPrompt: data as string,
          };
        }
        if (key === "role") {
          update.instructions = {
            ...prev.instructions,
            role: data as string,
          };
        }
      });
      return { ...prev, ...update };
    });
  }, []);

  const isLoadingTool = useMemo(() => {
    return isMcpLoading || isWorkflowLoading;
  }, [isMcpLoading, isWorkflowLoading]);

  const isLoading = useMemo(() => {
    return (
      isLoadingTool ||
      isSaving ||
      isVisibilityChangeLoading ||
      isBookmarkToggleLoading
    );
  }, [
    isLoadingTool,
    isSaving,
    isVisibilityChangeLoading,
    isBookmarkToggleLoading,
  ]);

  const isGenerating = openGenerateAgentDialog;

  return (
    <ScrollArea className="h-full w-full relative">
      <div className="w-full h-8 absolute bottom-0 left-0 bg-gradient-to-t from-background to-transparent z-20 pointer-events-none" />
      <div className="z-10 relative flex flex-col gap-4 px-4 sm:px-8 pt-8 pb-14 max-w-3xl h-full mx-auto overflow-x-hidden">
        <div className="sticky top-0 bg-background z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-2">
          <div className="w-full h-8 absolute top-[100%] left-0 bg-gradient-to-b from-background to-transparent z-20 pointer-events-none" />
          {isGenerating ? (
            <TextShimmer className="text-2xl font-bold">
              {t("Agent.generatingAgent")}
            </TextShimmer>
          ) : (
            <p className="text-2xl font-bold">{t("Agent.title")}</p>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            {hasEditAccess && !initialAgent && (
              <>
                <Button
                  variant="ghost"
                  disabled={isLoading}
                  onClick={() => setOpenGenerateAgentDialog(true)}
                  data-testid="agent-generate-with-ai-button"
                >
                  <WandSparklesIcon className="size-3" />
                  {t("Common.generateWithAI")}
                </Button>
                <LibraryButton />
              </>
            )}

            {initialAgent && (
              <div className="flex items-center gap-2">
                <ShareableActions
                  type="agent"
                  visibility={agent.visibility || "private"}
                  isBookmarked={agent?.isBookmarked || false}
                  isOwner={isOwner}
                  onVisibilityChange={updateVisibility}
                  isVisibilityChangeLoading={isVisibilityChangeLoading}
                  disabled={isLoading}
                  onBookmarkToggle={handleBookmarkToggle}
                  isBookmarkToggleLoading={isBookmarkToggleLoading}
                />
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-4 mt-4">
          <div className="flex flex-col justify-between gap-2 flex-1">
            <Label htmlFor="agent-name">
              {t("Agent.agentNameAndIconLabel")}
            </Label>
            {false ? (
              <Skeleton className="w-full h-10" />
            ) : (
              <Input
                value={agent.name || ""}
                onChange={(e) => setAgent({ name: e.target.value })}
                autoFocus
                disabled={isLoading || !hasEditAccess}
                className="hover:bg-input bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                id="agent-name"
                data-testid="agent-name-input"
                placeholder={t("Agent.agentNamePlaceholder")}
                readOnly={!hasEditAccess}
              />
            )}
          </div>
          {false ? (
            <Skeleton className="w-16 h-16" />
          ) : (
            <AgentIconPicker
              icon={agent.icon}
              disabled={!hasEditAccess}
              onChange={(icon) => setAgent({ icon })}
            />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="agent-description">
            {t("Agent.agentDescriptionLabel")}
          </Label>
          {false ? (
            <Skeleton className="w-full h-10" />
          ) : (
            <Input
              id="agent-description"
              data-testid="agent-description-input"
              disabled={isLoading || !hasEditAccess}
              placeholder={t("Agent.agentDescriptionPlaceholder")}
              className="hover:bg-input placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
              value={agent.description || ""}
              onChange={(e) => setAgent({ description: e.target.value })}
              readOnly={!hasEditAccess}
            />
          )}
        </div>

        <div className="mt-10 flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {t("Agent.agentSettingsDescription")}
          </p>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex gap-2 flex-col">
            <Label htmlFor="agent-prompt" className="text-base">
              {t("Agent.agentInstructionsLabel")}
            </Label>
            {false ? (
              <Skeleton className="w-full h-48" />
            ) : (
              <Textarea
                id="agent-prompt"
                data-testid="agent-prompt-textarea"
                ref={textareaRef}
                disabled={isLoading || !hasEditAccess}
                placeholder={t("Agent.agentInstructionsPlaceholder")}
                className="p-6 hover:bg-input min-h-48 max-h-96 overflow-y-auto resize-none placeholder:text-xs bg-secondary/40 transition-colors border-transparent border-none! focus-visible:bg-input! ring-0!"
                value={agent.instructions?.systemPrompt || ""}
                onChange={(e) =>
                  setAgent({
                    instructions: {
                      ...agent.instructions,
                      systemPrompt: e.target.value || "",
                    },
                  })
                }
                readOnly={!hasEditAccess}
              />
            )}
          </div>

          <div className="flex gap-2 flex-col">
            <Label htmlFor="agent-tool-bindings" className="text-base">
              {t("Agent.agentToolsLabel")}
            </Label>
            {false ? (
              <Skeleton className="w-full h-12" />
            ) : (
              <AgentToolSelector
                mentions={agent.instructions?.mentions || []}
                isLoading={isLoadingTool}
                disabled={isLoading}
                hasEditAccess={hasEditAccess}
                onChange={(mentions) =>
                  setAgent({
                    instructions: {
                      ...agent.instructions,
                      mentions,
                    },
                  })
                }
              />
            )}
          </div>

          <div className="flex gap-2 flex-col">
            <Label className="text-base">Model</Label>
            <p className="text-xs text-muted-foreground">
              The agent always answers with this model — in chat and in
              scheduled runs — regardless of the model selected in the chat.
            </p>
            <div className="flex items-center gap-2">
              <SelectModel
                currentModel={parseAgentModel(agent.model) ?? undefined}
                onSelect={(model) =>
                  setAgent({ model: formatAgentModel(model) })
                }
              >
                <Button
                  variant="secondary"
                  className="bg-secondary/40 data-[state=open]:bg-input! hover:bg-input!"
                  disabled={isLoading || !hasEditAccess}
                  data-testid="agent-model-select-button"
                >
                  {parseAgentModel(agent.model)?.model ?? "Default model"}
                  <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </SelectModel>
              {agent.model && hasEditAccess && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={isLoading}
                  onClick={() => setAgent({ model: null })}
                >
                  Use default
                </Button>
              )}
            </div>
          </div>

          <div className="flex gap-2 flex-col">
            <Label className="text-base">Knowledge bases</Label>
            <p className="text-xs text-muted-foreground">
              The agent searches only these knowledge bases when answering — in
              chat and in scheduled runs.
            </p>
            <AgentKnowledgeBaseSelector
              bindings={agent.instructions?.knowledgeBases || []}
              disabled={isLoading || !hasEditAccess}
              onChange={(knowledgeBases) =>
                setAgent({
                  instructions: {
                    ...agent.instructions,
                    knowledgeBases,
                  },
                })
              }
            />
          </div>
        </div>

        {/* Every schedule + last run, for owners of scheduled agents. An agent
            can own several named schedules; render each. */}
        {initialAgent && isOwner && schedules.length > 0 && (
          <div className="flex flex-col gap-2">
            {schedules.map((task) => (
              <ScheduleStatus
                key={task.id}
                task={task}
                onRan={() => refetchSchedule()}
                onChanged={() => refetchSchedule()}
              />
            ))}
          </div>
        )}

        {hasEditAccess && (
          <div className={cn("flex justify-end gap-2")}>
            {/* Delete button - only for owners */}
            {initialAgent && isOwner && (
              <Button
                className="mt-2 hover:text-destructive"
                variant="ghost"
                onClick={deleteAgent}
                disabled={isLoading}
              >
                {t("Common.delete")}
              </Button>
            )}

            {/* Add-schedule button - owners of existing agents add a new named
                schedule (editing/removing existing ones happens inline on each
                ScheduleStatus above); during creation the config is held
                locally and saved together with the agent. */}
            {initialAgent && isOwner && (
              <ScheduleButton
                taskType="agent"
                taskId={initialAgent.id}
                taskName={agent.name}
                variant="outline"
                className="mt-2"
                label={schedules.length > 0 ? "Add schedule" : "Schedule"}
                scheduleKey={nextScheduleKey}
                isLoadingSchedule={isLoadingSchedule}
                onScheduleCreated={() => {
                  refetchSchedule();
                }}
              />
            )}
            {!initialAgent && (
              <ScheduleButton
                taskType="agent"
                taskName={agent.name}
                variant="outline"
                className="mt-2"
                existingSchedule={pendingSchedule ?? undefined}
                onSubmitDeferred={setPendingSchedule}
              />
            )}

            <Button
              className={cn("mt-2", !initialAgent || !isOwner ? "ml-auto" : "")}
              onClick={saveAgent}
              disabled={isLoading || !hasEditAccess}
              data-testid="agent-save-button"
            >
              {isSaving ? t("Common.saving") : t("Common.save")}
              {isSaving && <Loader className="size-4 animate-spin" />}
            </Button>
          </div>
        )}
      </div>

      <GenerateAgentDialog
        open={openGenerateAgentDialog}
        onOpenChange={setOpenGenerateAgentDialog}
        onAgentChange={handleAgentChange}
        onToolsGenerated={assignToolsByNames}
      />
    </ScrollArea>
  );
}
