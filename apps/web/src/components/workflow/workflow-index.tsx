"use client";

import type { WorkflowSummary } from "app-types/workflow";
import { Plus, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";

/**
 * Workflow index.
 *
 * Lists the workflows the account can open and creates new ones. The hosted
 * edition replaces this route with its managed builder; here the editor at
 * /workflow/[id] is the way workflows are made.
 */
export function WorkflowIndex({
  workflows,
}: {
  workflows: WorkflowSummary[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const createWorkflow = async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "New workflow",
          description: "",
          icon: { type: "emoji", value: "⚡" },
          visibility: "private",
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const workflow = await response.json();
      router.push(`/workflow/${workflow.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not create workflow",
      );
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground">
            Build a tool from a graph of steps, then call it from any chat.
          </p>
        </div>
        <Button onClick={createWorkflow} disabled={creating}>
          <Plus className="size-4" />
          New workflow
        </Button>
      </div>

      {workflows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <WorkflowIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No workflows yet. Create one to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {workflows.map((workflow) => (
            <Link key={workflow.id} href={`/workflow/${workflow.id}`}>
              <Card className="transition-colors hover:border-foreground/20">
                <CardHeader className="py-4">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span>
                      {typeof workflow.icon?.value === "string"
                        ? workflow.icon.value
                        : "⚡"}
                    </span>
                    <span className="truncate">{workflow.name}</span>
                    {workflow.isPublished && (
                      <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                        published
                      </span>
                    )}
                  </CardTitle>
                  {workflow.description && (
                    <p className="line-clamp-1 text-sm text-muted-foreground">
                      {workflow.description}
                    </p>
                  )}
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
