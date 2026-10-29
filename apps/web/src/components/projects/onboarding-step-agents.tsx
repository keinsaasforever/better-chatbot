"use client";

import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { useAgents } from "@/hooks/queries/use-agents";
import { useProjectAgents } from "@/hooks/queries/use-project-agents";

export function OnboardingStepAgents({ projectId }: { projectId: string }) {
  const { agents, isLoading } = useAgents();
  const { data, mutate } = useProjectAgents(projectId);
  const [busyId, setBusyId] = useState<string | null>(null);

  const attachedIds = new Set((data?.agents ?? []).map((a) => a.agentId));

  const toggle = async (agentId: string) => {
    setBusyId(agentId);
    try {
      const isAttached = attachedIds.has(agentId);
      const res = await fetch(
        isAttached
          ? `/api/projects/${projectId}/agents?agentId=${agentId}`
          : `/api/projects/${projectId}/agents`,
        isAttached
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ agentId }),
            },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message ?? "Could not update agent.");
      }
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update agent.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Assign Navigator agents that will work on this project.
      </p>
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Loading your agents…
        </p>
      ) : agents.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed p-8">
          <div className="text-center">
            <Bot className="mx-auto mb-3 size-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No agents available yet. Create one first, then attach it here.
            </p>
          </div>
        </div>
      ) : (
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {agents.map((agent) => {
            const isAttached = attachedIds.has(agent.id);
            return (
              <div
                key={agent.id}
                className="flex items-center justify-between gap-2 rounded-lg p-2 hover:bg-muted"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Bot className="size-3.5" />
                  </div>
                  <p className="truncate text-sm">{agent.name}</p>
                </div>
                <Button
                  size="sm"
                  variant={isAttached ? "secondary" : "outline"}
                  className="h-7 px-2 text-xs"
                  disabled={busyId === agent.id}
                  onClick={() => toggle(agent.id)}
                >
                  {busyId === agent.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isAttached ? (
                    "Added"
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
