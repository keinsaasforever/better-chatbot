"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BotIcon, CalendarClock, CheckCircle2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  type DeferredScheduleConfig,
  ScheduleDialog,
} from "@/components/scheduled-tasks/schedule-dialog";
import { appStore } from "@/app/store";
import { useMutateAgents } from "@/hooks/queries/use-agents";
import { defaultToolMentionsFromNames } from "lib/ai/agent/default-tool-mentions";
import { storageKeyFromDownloadUrl } from "lib/code-runner/storage-key";
import {
  cronToHumanReadable,
  getUserTimezone,
} from "lib/scheduled-tasks/time-to-cron";

export interface CreateAgentProposal {
  name?: string;
  description?: string;
  role?: string;
  systemPrompt?: string;
  tools?: string[];
  files?: { url?: string; filename?: string }[];
  schedule?: {
    cronExpression?: string;
    timezone?: string;
    inputPrompt?: string;
  };
  model?: string;
}

export interface CreateAgentOutcome {
  created: boolean;
  agentId?: string;
  agentName?: string;
  agentUrl?: string;
  scheduleSummary?: string;
}

interface CreateAgentReviewProps {
  proposal: CreateAgentProposal;
  threadId?: string;
  /** Absent on a settled card, which only renders the outcome. */
  onCreate?: (outcome: CreateAgentOutcome) => void;
  onCancel?: () => void;
  outcome?: CreateAgentOutcome;
}

/**
 * Review card for the `createAgent` HITL tool.
 *
 * Nothing is written until the user presses Create: the tool has no `execute`,
 * so the model's proposal sits here, fully editable, and this component
 * performs the two writes (agent, then optional schedule) before answering the
 * parked tool call. A failure leaves the call unanswered on purpose — the user
 * can correct the fields and retry rather than losing the proposal.
 */
export function CreateAgentReviewUI({
  proposal,
  threadId,
  onCreate,
  onCancel,
  outcome,
}: CreateAgentReviewProps) {
  const t = useTranslations("Chat.CreateAgent");
  const mutateAgents = useMutateAgents();

  const [name, setName] = useState(proposal.name ?? "");
  const [description, setDescription] = useState(proposal.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(proposal.systemPrompt ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [schedule, setSchedule] = useState<DeferredScheduleConfig | null>(
    proposal.schedule?.cronExpression
      ? {
          cronExpression: proposal.schedule.cronExpression,
          timezone: proposal.schedule.timezone || getUserTimezone(),
          inputPrompt: proposal.schedule.inputPrompt || null,
          browserAutomationEnabled: false,
          browserCredentialAliases: [],
          enabled: true,
        }
      : null,
  );

  // Only real built-in tools survive; a hallucinated name would otherwise sit
  // in the agent forever resolving to nothing.
  const toolMentions = useMemo(
    () => defaultToolMentionsFromNames(proposal.tools),
    [proposal.tools],
  );

  // A file the model named but whose URL is not one of ours cannot be staged,
  // so drop it here rather than letting the API reject the whole agent.
  const files = useMemo(
    () =>
      (proposal.files ?? []).flatMap((file) => {
        if (!file.url || !file.filename) return [];
        const storageKey = storageKeyFromDownloadUrl(file.url);
        return storageKey ? [{ storageKey, filename: file.filename }] : [];
      }),
    [proposal.files],
  );

  const scheduleSummary = useMemo(() => {
    if (!schedule) return null;
    return cronToHumanReadable(schedule.cronExpression, schedule.timezone);
  }, [schedule]);

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName || !systemPrompt.trim()) {
      toast.error(t("nameAndPromptRequired"));
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          description: description.trim() || undefined,
          model: proposal.model,
          instructions: {
            role: proposal.role,
            systemPrompt,
            mentions: toolMentions,
            files,
          },
        }),
      });

      if (!response.ok) {
        toast.error(
          response.status === 403 ? t("noPermission") : t("createFailed"),
        );
        return;
      }

      const agent = (await response.json()) as { id: string; name: string };

      // The agent exists either way; a schedule that fails is reported on its
      // own so the user knows to add it from the agent page.
      let savedSchedule = false;
      if (schedule) {
        const scheduleResponse = await fetch("/api/scheduled-tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskType: "agent",
            agentId: agent.id,
            name: trimmedName,
            ...schedule,
          }),
        }).catch(() => null);
        savedSchedule = Boolean(scheduleResponse?.ok);
        if (!savedSchedule) toast.error(t("scheduleFailed"));
      }

      mutateAgents({ id: agent.id, name: agent.name });

      // Select the new agent for this thread so the user can keep working with
      // it straight away, matching what picking it from the sidebar does.
      if (threadId) {
        appStore.setState((prev) => ({
          threadMentions: {
            ...prev.threadMentions,
            [threadId]: [
              ...(prev.threadMentions[threadId] ?? []).filter(
                (mention) => mention.type !== "agent",
              ),
              {
                type: "agent" as const,
                name: agent.name,
                agentId: agent.id,
                description: description.trim() || undefined,
              },
            ],
          },
        }));
      }

      onCreate?.({
        created: true,
        agentId: agent.id,
        agentName: agent.name,
        agentUrl: `/agent/${agent.id}`,
        scheduleSummary:
          savedSchedule && scheduleSummary ? scheduleSummary : undefined,
      });
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setIsSaving(false);
    }
  }, [
    name,
    description,
    systemPrompt,
    proposal.model,
    proposal.role,
    toolMentions,
    files,
    schedule,
    scheduleSummary,
    threadId,
    mutateAgents,
    onCreate,
    t,
  ]);

  if (outcome) {
    return (
      <div className="my-3">
        <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <BotIcon className="h-4 w-4" aria-hidden />
            {t("title")}
            <span className="ml-auto flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {outcome.created ? t("createdBadge") : t("cancelledBadge")}
            </span>
          </div>
          {outcome.created && (
            <div className="space-y-1 px-4 py-3 text-sm">
              <p className="font-medium text-foreground">
                {outcome.agentUrl ? (
                  <Link className="hover:underline" href={outcome.agentUrl}>
                    {outcome.agentName}
                  </Link>
                ) : (
                  outcome.agentName
                )}
              </p>
              {outcome.scheduleSummary && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden />
                  {outcome.scheduleSummary}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="my-3">
      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <BotIcon className="h-4 w-4" aria-hidden />
          {t("title")}
        </div>

        <div className="space-y-4 px-4 py-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="create-agent-name">{t("nameLabel")}</Label>
            <Input
              id="create-agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-agent-description">
              {t("descriptionLabel")}
            </Label>
            <Input
              id="create-agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={isSaving}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-agent-prompt">{t("promptLabel")}</Label>
            <Textarea
              id="create-agent-prompt"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              rows={8}
              disabled={isSaving}
            />
          </div>

          {toolMentions.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("toolsLabel")}</Label>
              <div className="flex flex-wrap gap-1.5">
                {toolMentions.map((mention) => (
                  <span
                    className="rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                    key={mention.name}
                  >
                    {mention.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-1.5">
              <Label>{t("filesLabel")}</Label>
              <ul className="space-y-1">
                {files.map((file) => (
                  <li
                    className="flex items-center gap-1.5 text-xs text-muted-foreground"
                    key={file.storageKey}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    {file.filename}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{t("scheduleLabel")}</Label>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">
                {scheduleSummary ?? t("noSchedule")}
              </p>
              <Button
                className="ml-auto"
                disabled={isSaving}
                onClick={() => setScheduleOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                {schedule ? t("editSchedule") : t("addSchedule")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <Button
            disabled={isSaving}
            onClick={handleCreate}
            size="sm"
            type="button"
          >
            {isSaving ? t("creating") : t("create")}
          </Button>
          <Button
            disabled={isSaving}
            onClick={() => onCancel?.()}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("cancel")}
          </Button>
        </div>
      </div>

      <ScheduleDialog
        existingSchedule={schedule ?? undefined}
        onOpenChange={setScheduleOpen}
        onSubmitDeferred={setSchedule}
        open={scheduleOpen}
        taskName={name}
        taskType="agent"
      />
    </div>
  );
}
