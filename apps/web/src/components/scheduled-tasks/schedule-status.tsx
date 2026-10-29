"use client";

import { useState } from "react";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { cn } from "lib/utils";
import { cronToHumanReadable } from "@/lib/scheduled-tasks/time-to-cron";
import { ScheduleButton } from "./schedule-button";

/**
 * Fuller schedule status block for the agent edit page: what the schedule is,
 * when it last ran (with a link to the run's chat), when it runs next, plus
 * "Run now" (executes immediately, bypassing Inngest, so the run route can be
 * tested on demand), Edit, and Delete. Accepts the raw task object from
 * GET /api/scheduled-tasks.
 */
export function ScheduleStatus({
  task,
  className,
  onRan,
  onChanged,
}: {
  task: {
    id: string;
    agentId?: string;
    cronExpression: string;
    timezone: string;
    inputPrompt?: string | null;
    key?: string;
    enabled: boolean | null;
    lastRunAt: string | Date | null;
    lastRunStatus: "success" | "failure" | "timeout" | null;
    lastChatThreadId: string | null;
    nextRunAt?: string | Date | null;
  };
  className?: string;
  /** Called after a manual run so the caller can refetch the schedule. */
  onRan?: () => void;
  /** Called after this schedule is edited or deleted. */
  onChanged?: () => void;
}) {
  const [isRunning, setIsRunning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteSchedule = async () => {
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/scheduled-tasks/${task.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      onChanged?.();
    } catch {
      toast.error("Could not delete the schedule.");
    } finally {
      setIsDeleting(false);
    }
  };

  const runNow = async () => {
    setIsRunning(true);
    try {
      const res = await fetch(`/api/scheduled-tasks/${task.id}/run`, {
        method: "POST",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.skipped || data?.success === false) {
        toast.error(
          data?.reason || data?.error || "The run failed. Check the logs.",
        );
      }
    } catch {
      toast.error("Could not start the run.");
    } finally {
      setIsRunning(false);
      onRan?.();
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md bg-secondary/40 px-4 py-3 text-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">
          {cronToHumanReadable(task.cronExpression, task.timezone)}{" "}
          <span className="text-muted-foreground font-normal">
            ({task.timezone}){!task.enabled && " — paused"}
          </span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isRunning}
            onClick={runNow}
            data-testid="schedule-run-now-button"
          >
            {isRunning ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {isRunning ? "Running…" : "Run now"}
          </Button>
          {task.agentId && (
            <ScheduleButton
              taskType="agent"
              taskId={task.agentId}
              variant="ghost"
              size="sm"
              label="Edit"
              existingSchedule={task}
              onScheduleCreated={() => onChanged?.()}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isDeleting}
            onClick={deleteSchedule}
            aria-label="Delete schedule"
          >
            {isDeleting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </Button>
        </div>
      </div>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {task.lastRunAt ? (
          <>
            {task.lastRunStatus === "success" ? (
              <CheckCircle2 className="size-3.5 text-green-500" />
            ) : (
              <AlertCircle className="size-3.5 text-destructive" />
            )}
            Last run{" "}
            {formatDistanceToNow(new Date(task.lastRunAt), {
              addSuffix: true,
            })}
            {task.lastRunStatus !== "success" && " (failed)"}
            {task.lastChatThreadId && (
              <Link
                href={`/chat/${task.lastChatThreadId}`}
                className="ml-1 inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                View run
                <ExternalLink className="size-3" />
              </Link>
            )}
          </>
        ) : (
          "Has not run yet"
        )}
      </span>
      {task.enabled && task.nextRunAt && (
        <span className="text-muted-foreground">
          Next run {format(new Date(task.nextRunAt), "MMM d, HH:mm")}
        </span>
      )}
    </div>
  );
}
