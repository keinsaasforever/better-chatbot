"use client";

import { useComposioConnections } from "@/hooks/queries/use-composio-connections";
import { fetcher } from "lib/utils";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Plug,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import useSWR, { useSWRConfig } from "swr";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Input } from "ui/input";

function openOAuthPopup(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const popup = window.open(
      url,
      "composio-oauth",
      "width=600,height=700,left=200,top=100,scrollbars=yes",
    );
    if (!popup) {
      reject(new Error("popup_blocked"));
      return;
    }
    const timer = setInterval(() => {
      if (popup.closed) {
        clearInterval(timer);
        resolve();
      }
    }, 500);
  });
}

type ProjectTool = {
  id: string;
  providerType: string;
  providerRef: string;
};

/**
 * Searchable Composio toolkit grid with per-toolkit Connect (OAuth) /
 * Add-to-project / Added states. Shared by the project onboarding Tools step
 * and the Brain tab's "Add tool" dialog.
 */
export function ProjectToolPicker({
  projectId,
  onAttached,
}: {
  projectId: string;
  onAttached?: () => void;
}) {
  const [search, setSearch] = useState("");
  // Slug currently mid-flight (OAuth and/or attach + sync).
  const [busy, setBusy] = useState<string | null>(null);
  // Slugs ATTACHED to this project — distinct from account-level Composio
  // connection.
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const { mutate: globalMutate } = useSWRConfig();

  const {
    data,
    isLoading,
    mutate: mutateConnections,
  } = useComposioConnections(search || undefined, {
    refreshInterval: 0,
  });

  // Tools already attached to this project (separate from Composio account
  // connection status returned by /api/connections).
  const { data: projectToolsData, mutate: mutateProjectTools } = useSWR<{
    tools: ProjectTool[];
  }>(`/api/projects/${projectId}/tools`, fetcher);

  const toolkits = data?.toolkits ?? [];

  useEffect(() => {
    if (!projectToolsData?.tools) return;
    setAttached(
      new Set(
        projectToolsData.tools
          .filter((t) => t.providerType === "composio")
          .map((t) => t.providerRef),
      ),
    );
  }, [projectToolsData]);

  // Attach an (already account-connected) toolkit to this project, then kick
  // off an immediate sync so widgets fill right after connect. `connectionRef`
  // is the Composio connected-account id; when omitted the server resolves the
  // newest active account for the toolkit.
  const attachToProject = useCallback(
    async (slug: string, name: string, connectionRef?: string) => {
      const saveRes = await fetch(`/api/projects/${projectId}/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerType: "composio",
          providerRef: slug,
          ...(connectionRef ? { connectionRef } : {}),
          displayName: name,
        }),
      });
      if (!saveRes.ok) {
        const payload = await saveRes.json().catch(() => null);
        throw new Error(
          payload?.error?.message ?? "Could not add the tool to this project.",
        );
      }
      const { tool } = (await saveRes.json()) as { tool: { id: string } };

      setAttached((prev) => new Set([...prev, slug]));
      void mutateProjectTools();
      onAttached?.();

      // Fire the immediate sync. We don't block the UI on it; when it finishes
      // we refresh the workspace so the widgets update live.
      void fetch(`/api/projects/${projectId}/tools/${tool.id}/sync`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
          await globalMutate(`/api/projects/${projectId}/status-snapshot`);
          await globalMutate(`/api/projects/${projectId}/overview`);
        })
        .catch(() => {
          // Network/timeout before a result came back; the daily cycle retries.
          toast.error(
            `${name} added, but the first sync didn't start. It will retry on the next cycle.`,
          );
        });
    },
    [projectId, globalMutate, mutateProjectTools, onAttached],
  );

  // Already connected to the Composio account — just attach to this project.
  const handleAdd = useCallback(
    async (slug: string, name: string, connectedAccountId?: string) => {
      setBusy(slug);
      try {
        await attachToProject(slug, name, connectedAccountId);
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to add tool to project.");
      } finally {
        setBusy(null);
      }
    },
    [attachToProject],
  );

  // After OAuth the new connected-account id lands asynchronously (webhook);
  // poll the refreshed list a few times so the attach can carry it. The server
  // falls back to the newest active account when we give up.
  const pollForConnectedAccountId = useCallback(
    async (slug: string) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const refreshed = await mutateConnections();
        const accountId = refreshed?.toolkits.find(
          (toolkit) => toolkit.slug === slug,
        )?.connectedAccountId;
        if (accountId) return accountId;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      return undefined;
    },
    [mutateConnections],
  );

  // Not connected yet — run Composio OAuth, then attach to this project.
  const handleConnect = useCallback(
    async (slug: string, name: string) => {
      setBusy(slug);
      try {
        const res = await fetch("/api/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolkit: slug,
            callbackUrl: window.location.href,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        const { redirectUrl } = await res.json();
        if (!redirectUrl) throw new Error("No redirect URL from Composio");

        try {
          await openOAuthPopup(redirectUrl);
        } catch {
          // Popup blocked — fall back to full redirect.
          window.location.href = redirectUrl;
          return;
        }

        const connectedAccountId = await pollForConnectedAccountId(slug);
        await attachToProject(slug, name, connectedAccountId);
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to connect tool.");
      } finally {
        setBusy(null);
      }
    },
    [attachToProject, pollForConnectedAccountId],
  );

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search tools…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : toolkits.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No tools found
        </p>
      ) : (
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-2 max-h-[320px] overflow-y-auto pr-1">
          {toolkits.map((tool) => {
            const isAttached = attached.has(tool.slug);
            const isBusy = busy === tool.slug;
            return (
              <div
                key={tool.slug}
                className="relative flex flex-col items-center gap-2 rounded-xl border p-3"
              >
                {tool.isConnected && (
                  <span className="absolute top-2 right-2 size-2 rounded-full bg-green-500" />
                )}
                <div className="size-9 rounded-lg overflow-hidden flex items-center justify-center bg-background border border-border shrink-0 mt-1">
                  {tool.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tool.logo}
                      alt={tool.name}
                      className="size-7 object-contain"
                    />
                  ) : (
                    <Plug className="size-4 text-muted-foreground" />
                  )}
                </div>
                <p className="text-xs font-medium text-center leading-tight line-clamp-2">
                  {tool.name}
                </p>

                {isAttached ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 border-emerald-500/40 bg-emerald-50/20 text-emerald-600 text-[11px]"
                  >
                    <CheckCircle2 className="size-3" />
                    Added
                  </Badge>
                ) : tool.isConnected ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-[11px] h-6 px-2 gap-1"
                    disabled={isBusy}
                    onClick={() =>
                      handleAdd(tool.slug, tool.name, tool.connectedAccountId)
                    }
                  >
                    {isBusy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Plus className="size-3" />
                    )}
                    {isBusy ? "Adding…" : "Add"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full text-[11px] h-6 px-2 gap-1"
                    disabled={isBusy}
                    onClick={() => handleConnect(tool.slug, tool.name)}
                  >
                    {isBusy ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ExternalLink className="size-3" />
                    )}
                    {isBusy ? "…" : "Connect"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {attached.size > 0 && (
        <p className="text-xs text-muted-foreground">
          {attached.size} tool{attached.size > 1 ? "s" : ""} added to this
          project — daily sync will keep the brain up to date.
        </p>
      )}
    </div>
  );
}
