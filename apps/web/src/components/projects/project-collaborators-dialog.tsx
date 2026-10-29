"use client";

import { IS_CLOUD_EDITION } from "@/lib/edition";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bot, Loader2, Search, UserRound, Workflow, X } from "lucide-react";
import { authClient } from "auth/client";
import { fetcher } from "lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "ui/avatar";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import { useAgents } from "@/hooks/queries/use-agents";
import {
  type ProjectAgentRow,
  useProjectAgents,
} from "@/hooks/queries/use-project-agents";
import {
  type ProjectMemberRow,
  useProjectMembers,
} from "@/hooks/queries/use-project-members";
import {
  type ProjectWorkflowRow,
  useProjectWorkflows,
} from "@/hooks/queries/use-project-workflows";

type OrgMember = {
  id: string;
  userId: string;
  user: { name: string | null; email: string | null; image: string | null };
};

type WorkflowSummary = {
  id: string;
  name: string;
  description?: string | null;
};

function initials(name: string | null | undefined, email: string | null) {
  const source = name || email || "?";
  return source.slice(0, 2).toUpperCase();
}

function PeopleTab({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const { data: activeOrg } = authClient.useActiveOrganization();
  const { data, mutate } = useProjectMembers(projectId);
  const { data: orgData } = useSWR<{ members: OrgMember[] }>(
    // Org membership only exists in the hosted product; elsewhere there is
    // nobody to add and the endpoint is not part of the build.
    IS_CLOUD_EDITION && activeOrg
      ? `/api/organization/${activeOrg.id}/members`
      : null,
    fetcher,
  );
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  const members = data?.members ?? [];
  const memberUserIds = new Set(members.map((m) => m.userId));
  const candidates = (orgData?.members ?? []).filter(
    (m) => !memberUserIds.has(m.userId),
  );

  const addMember = async (userId: string) => {
    setBusyUserId(userId);
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role: "editor" }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message ?? "Could not add member.");
      }
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add member.",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const removeMember = async (member: ProjectMemberRow) => {
    setBusyUserId(member.userId);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/members?userId=${member.userId}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message ?? "Could not remove member.");
      }
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove member.",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {members.map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between gap-2 rounded-lg border p-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Avatar className="size-7">
                <AvatarImage src={member.image ?? undefined} />
                <AvatarFallback className="text-[11px]">
                  {initials(member.name, member.email)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.name ?? member.email ?? member.userId}
                </p>
                {member.email && (
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </p>
                )}
              </div>
            </div>
            {member.role === "owner" ? (
              <Badge variant="secondary">Owner</Badge>
            ) : canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={busyUserId === member.userId}
                onClick={() => removeMember(member)}
              >
                {busyUserId === member.userId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
              </Button>
            ) : (
              <Badge variant="outline">{member.role}</Badge>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No people yet.
          </p>
        )}
      </div>

      {canEdit && candidates.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <p className="text-xs font-medium text-muted-foreground">
            Add from your organization
          </p>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {candidates.map((candidate) => (
              <div
                key={candidate.userId}
                className="flex items-center justify-between gap-2 rounded-lg p-1.5 hover:bg-muted"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Avatar className="size-6">
                    <AvatarImage src={candidate.user.image ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {initials(candidate.user.name, candidate.user.email)}
                    </AvatarFallback>
                  </Avatar>
                  <p className="truncate text-sm">
                    {candidate.user.name ??
                      candidate.user.email ??
                      candidate.userId}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={busyUserId === candidate.userId}
                  onClick={() => addMember(candidate.userId)}
                >
                  {busyUserId === candidate.userId ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AgentsTab({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const { data, mutate } = useProjectAgents(projectId);
  const { agents } = useAgents();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const attached = data?.agents ?? [];
  const attachedIds = new Set(attached.map((a) => a.agentId));
  const candidates = agents.filter(
    (agent) =>
      !attachedIds.has(agent.id) &&
      agent.name.toLowerCase().includes(search.toLowerCase()),
  );

  const attach = async (agentId: string) => {
    setBusyId(agentId);
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message ?? "Could not add agent.");
      }
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add agent.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const detach = async (agent: ProjectAgentRow) => {
    setBusyId(agent.agentId);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/agents?agentId=${agent.agentId}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message ?? "Could not remove agent.");
      }
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove agent.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {attached.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between gap-2 rounded-lg border p-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="size-3.5" />
              </div>
              <p className="truncate text-sm font-medium">{agent.name}</p>
            </div>
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={busyId === agent.agentId}
                onClick={() => detach(agent)}
              >
                {busyId === agent.agentId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        ))}
        {attached.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No agents attached yet.
          </p>
        )}
      </div>

      {canEdit && (
        <div className="space-y-2 border-t pt-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search your agents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {candidates.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between gap-2 rounded-lg p-1.5 hover:bg-muted"
              >
                <p className="truncate text-sm">{agent.name}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={busyId === agent.id}
                  onClick={() => attach(agent.id)}
                >
                  {busyId === agent.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            ))}
            {candidates.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                No matching agents.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowsTab({
  projectId,
  canEdit,
}: {
  projectId: string;
  canEdit: boolean;
}) {
  const { data, mutate } = useProjectWorkflows(projectId);
  const { data: allWorkflows } = useSWR<WorkflowSummary[]>(
    "/api/workflow",
    fetcher,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const attached = data?.workflows ?? [];
  const attachedIds = new Set(attached.map((w) => w.workflowId));
  const candidates = useMemo(
    () =>
      (allWorkflows ?? []).filter(
        (workflow) =>
          !attachedIds.has(workflow.id) &&
          workflow.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [allWorkflows, attachedIds, search],
  );

  const attach = async (workflowId: string) => {
    setBusyId(workflowId);
    try {
      const res = await fetch(`/api/projects/${projectId}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error?.message ?? "Could not add workflow.");
      }
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add workflow.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const detach = async (workflow: ProjectWorkflowRow) => {
    setBusyId(workflow.workflowId);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/workflows?workflowId=${workflow.workflowId}`,
        { method: "DELETE" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          payload?.error?.message ?? "Could not remove workflow.",
        );
      }
      await mutate();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove workflow.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {attached.map((workflow) => (
          <div
            key={workflow.id}
            className="flex items-center justify-between gap-2 rounded-lg border p-2"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Workflow className="size-3.5" />
              </div>
              <p className="truncate text-sm font-medium">{workflow.name}</p>
            </div>
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                disabled={busyId === workflow.workflowId}
                onClick={() => detach(workflow)}
              >
                {busyId === workflow.workflowId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <X className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        ))}
        {attached.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No workflows attached yet.
          </p>
        )}
      </div>

      {canEdit && (
        <div className="space-y-2 border-t pt-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search your workflows…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {candidates.map((workflow) => (
              <div
                key={workflow.id}
                className="flex items-center justify-between gap-2 rounded-lg p-1.5 hover:bg-muted"
              >
                <p className="truncate text-sm">{workflow.name}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  disabled={busyId === workflow.id}
                  onClick={() => attach(workflow.id)}
                >
                  {busyId === workflow.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    "Add"
                  )}
                </Button>
              </div>
            ))}
            {candidates.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                No matching workflows.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ProjectCollaboratorsDialog({
  projectId,
  open,
  onOpenChange,
  defaultTab = "people",
  canEdit,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "people" | "agents" | "workflows";
  canEdit: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Project collaborators</DialogTitle>
          <DialogDescription>
            Manage who and what can work on this project.
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue={defaultTab}>
          <TabsList>
            <TabsTrigger value="people">
              <UserRound className="mr-2 size-3.5" />
              People
            </TabsTrigger>
            <TabsTrigger value="agents">
              <Bot className="mr-2 size-3.5" />
              Agents
            </TabsTrigger>
            <TabsTrigger value="workflows">
              <Workflow className="mr-2 size-3.5" />
              Workflows
            </TabsTrigger>
          </TabsList>
          <TabsContent value="people">
            <PeopleTab projectId={projectId} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="agents">
            <AgentsTab projectId={projectId} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="workflows">
            <WorkflowsTab projectId={projectId} canEdit={canEdit} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
