"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { ScheduleDialog, type DeferredScheduleConfig } from "./schedule-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface ScheduleButtonProps {
  taskType: "agent";
  /** Absent while the agent is being created — the dialog defers the config. */
  taskId?: string;
  taskName?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  existingSchedule?: any;
  /** Name for a NEW schedule so it upserts distinctly (default "default"). */
  scheduleKey?: string;
  /** Label override, e.g. "Add schedule" when adding another to an agent. */
  label?: string;
  isLoadingSchedule?: boolean;
  onScheduleCreated?: () => void;
  /** Create flow: receives the config to submit after the agent is saved. */
  onSubmitDeferred?: (config: DeferredScheduleConfig) => void;
}

export function ScheduleButton({
  taskType,
  taskId,
  taskName,
  variant = "outline",
  size = "default",
  className,
  existingSchedule,
  scheduleKey,
  label,
  isLoadingSchedule,
  onScheduleCreated,
  onSubmitDeferred,
}: ScheduleButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  if (isLoadingSchedule) {
    return <Skeleton className="h-10 w-28" />;
  }

  return (
    <>
      <div className="relative inline-block">
        <Button
          variant={variant}
          size={size}
          onClick={() => setDialogOpen(true)}
          className={cn(className, existingSchedule && "pr-8")}
        >
          <CalendarClock className="mr-2 h-4 w-4" />
          {label ?? (existingSchedule ? "Update Schedule" : "Schedule")}
        </Button>
        {existingSchedule && existingSchedule.enabled && (
          <CheckCircle2 className="absolute -right-1 -top-1 h-4 w-4 text-green-500 bg-background rounded-full" />
        )}
      </div>

      <ScheduleDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        taskType={taskType}
        taskId={taskId}
        taskName={taskName}
        existingSchedule={existingSchedule}
        scheduleKey={scheduleKey}
        onSubmitDeferred={onSubmitDeferred}
        onScheduleCreated={() => {
          onScheduleCreated?.();
          setDialogOpen(false);
        }}
      />
    </>
  );
}
