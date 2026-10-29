"use client";

import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { cn } from "@/lib/utils";
import type { AgentAlertKind } from "@/lib/agent-alerts/types";
import {
  buildAgentAlertCopy,
  getAgentAlertToastId,
  getChatPath,
} from "@/lib/agent-alerts/copy";
import type { ResolvedNotificationPrefs } from "@/lib/agent-alerts/types";

type AgentAlertToastProps = {
  kind: AgentAlertKind;
  threadId?: string;
  title?: string;
  prefs: ResolvedNotificationPrefs;
  onNavigate: (path: string) => void;
};

function KindIcon({ kind }: { kind: AgentAlertKind }) {
  const className = "size-4 shrink-0";
  switch (kind) {
    case "complete":
      return <CheckCircle2 className={cn(className, "text-emerald-500")} />;
    case "needs_approval":
      return <ShieldAlert className={cn(className, "text-amber-500")} />;
    case "needs_input":
      return <HelpCircle className={cn(className, "text-sky-500")} />;
    case "error":
      return <AlertCircle className={cn(className, "text-destructive")} />;
  }
}

function AgentAlertToast({
  kind,
  threadId,
  title,
  prefs,
  onNavigate,
}: AgentAlertToastProps) {
  const copy = buildAgentAlertCopy({ kind, title }, prefs);
  const path = getChatPath(threadId);

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-[min(22rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-card p-3 shadow-lg",
        "ring-1 ring-border/60",
      )}
    >
      <div className="mt-0.5">
        <KindIcon kind={kind} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-tight">{copy.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{copy.body}</p>
        <Button
          size="sm"
          variant="secondary"
          className="mt-2 h-7 px-2 text-xs"
          onClick={() => {
            toast.dismiss(getAgentAlertToastId(threadId, kind));
            onNavigate(path);
          }}
        >
          {copy.actionLabel}
        </Button>
      </div>
    </div>
  );
}

export function showAgentAlertToast(
  opts: {
    kind: AgentAlertKind;
    threadId?: string;
    title?: string;
  },
  prefs: ResolvedNotificationPrefs,
  onNavigate: (path: string) => void,
): void {
  const toastId = getAgentAlertToastId(opts.threadId, opts.kind);
  const duration =
    opts.kind === "complete" || opts.kind === "error" ? 6000 : Infinity;

  toast.custom(
    () => (
      <AgentAlertToast
        kind={opts.kind}
        threadId={opts.threadId}
        title={opts.title}
        prefs={prefs}
        onNavigate={onNavigate}
      />
    ),
    { id: toastId, duration },
  );
}
