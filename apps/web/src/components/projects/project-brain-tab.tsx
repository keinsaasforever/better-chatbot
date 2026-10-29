"use client";

import { fetcher } from "@/lib/utils";
import { Loader2, Plus, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { ProjectAddSourceDialog } from "./project-add-source-dialog";
import { ProjectAddToolDialog } from "./project-add-tool-dialog";
import { ProjectContradictionsCard } from "./project-contradictions-card";
import {
  type ProjectDocumentForGrid,
  ProjectDocumentsGrid,
} from "./project-documents-grid";
import { ProjectUploadDialog } from "./project-upload-dialog";

const TOOL_STATUS_STYLES: Record<string, string> = {
  connected: "border-emerald-500/40 text-emerald-600",
  needs_auth: "border-amber-500/40 text-amber-600",
  error: "border-red-500/40 text-red-600",
  disabled: "border-border text-muted-foreground",
};

function ToolStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 ${TOOL_STATUS_STYLES[status] ?? ""}`}
    >
      {status.replace("_", " ")}
    </Badge>
  );
}

export function ProjectBrainTab({
  projectId,
  initialDocuments,
  canEdit,
}: {
  projectId: string;
  initialDocuments: ProjectDocumentForGrid[];
  canEdit: boolean;
}) {
  const brainKey = `/api/projects/${projectId}/brain`;
  const { data, error, mutate } = useSWR<any>(brainKey, fetcher);
  const { mutate: globalMutate } = useSWRConfig();

  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [addToolOpen, setAddToolOpen] = useState(false);
  const [busyToolId, setBusyToolId] = useState<string | null>(null);

  const refreshBrain = () => {
    void mutate();
    void globalMutate(`/api/projects/${projectId}/status`);
    void globalMutate(`/api/projects/${projectId}/overview`);
  };

  const syncTool = async (toolId: string, _name: string) => {
    setBusyToolId(toolId);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tools/${toolId}/sync`,
        { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error?.message ?? "Could not start sync.");
      }
      void globalMutate(`/api/projects/${projectId}/runs/latest`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start sync.");
    } finally {
      setBusyToolId(null);
    }
  };

  const removeTool = async (toolId: string, _name: string) => {
    setBusyToolId(toolId);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/tools/${toolId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message ?? "Could not remove tool.");
      }
      refreshBrain();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not remove tool.",
      );
    } finally {
      setBusyToolId(null);
    }
  };

  if (error) return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data)
    return (
      <p className="text-sm text-muted-foreground">Loading project brain…</p>
    );

  const documents: ProjectDocumentForGrid[] = (data.documents ?? []).map(
    (doc: any) => ({
      id: doc.id,
      filename: doc.filename,
      contentType: doc.contentType,
      size: doc.size,
      createdAt: doc.createdAt,
      chunkCount: doc.chunkCount ?? 0,
      // Brain rows carry the agentset status; the grid's /status poll swaps in
      // exact local embedding progress right after mount.
      embeddingStatus:
        doc.embeddingStatus ??
        (doc.agentsetStatus === "pending" || doc.agentsetStatus === "processing"
          ? "processing"
          : doc.agentsetStatus === "failed"
            ? "failed"
            : "completed"),
    }),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Sources</CardTitle>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddSourceOpen(true)}
            >
              <Plus className="mr-1 size-3.5" />
              Add source
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Documents ({documents.length})
            </p>
            {documents.length || initialDocuments.length ? (
              <ProjectDocumentsGrid
                projectId={projectId}
                initialDocuments={
                  documents.length ? documents : initialDocuments
                }
              />
            ) : (
              <p className="text-muted-foreground">
                No documents yet. Upload files or paste a transcript.
              </p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Transcripts ({data.transcripts.length})
            </p>
            {data.transcripts.length ? (
              <div className="space-y-2">
                {data.transcripts.slice(0, 5).map((transcript: any) => (
                  <div className="rounded-lg border p-2" key={transcript.id}>
                    <p className="line-clamp-2 text-xs">{transcript.text}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(transcript.createdAt).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No transcripts yet.</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {data.sources.length} memory sources ingested in total.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Connected tools</CardTitle>
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddToolOpen(true)}
            >
              <Plus className="mr-1 size-3.5" />
              Add tool
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {data.tools.length ? (
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-2">
              {data.tools.map((tool: any) => (
                <div
                  className="flex flex-col items-center gap-1.5 rounded-xl border p-2.5"
                  key={tool.id}
                >
                  <p className="w-full truncate text-center text-xs font-medium">
                    {tool.displayName}
                  </p>
                  <ToolStatusBadge status={tool.status} />
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        title="Sync now"
                        disabled={busyToolId === tool.id}
                        onClick={() => syncTool(tool.id, tool.displayName)}
                      >
                        {busyToolId === tool.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <RefreshCw className="size-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-destructive"
                        title="Remove from project"
                        disabled={busyToolId === tool.id}
                        onClick={() => removeTool(tool.id, tool.displayName)}
                      >
                        <X className="size-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No connector attached.
            </p>
          )}
        </CardContent>
      </Card>

      <ProjectContradictionsCard projectId={projectId} canEdit={canEdit} />

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Recent memory</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {data.pages.map((page: any) => (
            <div className="rounded-lg border p-3" key={page.id}>
              <p className="font-medium">{page.title}</p>
              <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                {page.summary ?? page.compiledTruth ?? "No facts yet."}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>

      <ProjectAddSourceDialog
        projectId={projectId}
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        onUploadFiles={() => setUploadOpen(true)}
        onIngested={refreshBrain}
      />
      <ProjectUploadDialog
        projectId={projectId}
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploadComplete={refreshBrain}
      />
      <ProjectAddToolDialog
        projectId={projectId}
        open={addToolOpen}
        onOpenChange={setAddToolOpen}
        onAttached={refreshBrain}
      />
    </div>
  );
}
