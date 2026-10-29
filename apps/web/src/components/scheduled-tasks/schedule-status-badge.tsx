"use client";

import { formatDistanceToNow } from "date-fns";
import { CalendarClock } from "lucide-react";
import { cn } from "lib/utils";
import type { ScheduledTaskSummary } from "@/hooks/queries/use-scheduled-tasks";

/**
 * Compact last-run indicator for agent cards: status dot + relative time.
 */
export function ScheduleStatusBadge({
  task,
  className,
}: {
  task: Pick<ScheduledTaskSummary, "lastRunAt" | "lastRunStatus" | "enabled">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <CalendarClock className="size-3" />
      <span
        className={cn(
          "size-1.5 rounded-full",
          task.lastRunStatus === "success" && "bg-green-500",
          (task.lastRunStatus === "failure" ||
            task.lastRunStatus === "timeout") &&
            "bg-destructive",
          !task.lastRunStatus && "bg-muted-foreground/50",
        )}
      />
      {task.lastRunAt
        ? `Last run ${formatDistanceToNow(new Date(task.lastRunAt), { addSuffix: true })}`
        : task.enabled
          ? "Scheduled — not run yet"
          : "Schedule paused"}
    </span>
  );
}
