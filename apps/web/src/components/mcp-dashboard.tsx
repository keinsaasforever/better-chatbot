"use client";
import { McpShareableCard } from "@/components/mcp-shareable-card";

import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";

import { Skeleton } from "ui/skeleton";

import { ScrollArea } from "ui/scroll-area";
import { useTranslations } from "next-intl";
import { useMcpList } from "@/hooks/queries/use-mcp-list";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { Loader2, Plug, Search, X, Zap } from "lucide-react";
import { cn, fetcher } from "lib/utils";
import { authClient } from "auth/client";
import {
  useComposioConnections,
  type ComposioToolkit,
} from "@/hooks/queries/use-composio-connections";
import {
  Drawer,
  DrawerContent,
  DrawerPortal,
  DrawerTitle,
  DrawerDescription,
} from "ui/drawer";
import { Input } from "ui/input";
import useSWR from "swr";

const LightRays = dynamic(() => import("@/components/ui/light-rays"), {
  ssr: false,
});

// ─── Composio Drawer Card ─────────────────────────────────────────────────────

function ComposioDrawerCard({
  toolkit,
  onConnect,
  onDisconnect,
  isConnecting,
}: {
  toolkit: ComposioToolkit;
  onConnect: (slug: string) => void;
  onDisconnect: (id: string) => void;
  isConnecting: boolean;
}) {
  const t = useTranslations("MCP");
  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all",
        toolkit.isConnected
          ? "border-green-500/50 bg-green-500/5"
          : "border-border hover:border-primary/30 hover:bg-secondary/40",
      )}
    >
      {toolkit.isConnected && (
        <span className="absolute top-2 right-2 size-2 rounded-full bg-green-500" />
      )}
      <div className="size-9 rounded-lg overflow-hidden flex items-center justify-center bg-background border border-border shrink-0 mt-1">
        {toolkit.logo ? (
          <img
            src={toolkit.logo}
            alt={toolkit.name}
            className="size-7 object-contain"
          />
        ) : (
          <Plug className="size-4 text-muted-foreground" />
        )}
      </div>
      <p className="text-xs font-medium text-center leading-tight line-clamp-2">
        {toolkit.name}
      </p>
      {toolkit.isConnected ? (
        <Button
          size="sm"
          variant="ghost"
          className="w-full text-[11px] h-6 px-2 text-muted-foreground hover:text-destructive"
          onClick={() =>
            toolkit.connectedAccountId &&
            onDisconnect(toolkit.connectedAccountId)
          }
        >
          Disconnect
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full text-[11px] h-6 px-2"
          disabled={isConnecting}
          onClick={() => onConnect(toolkit.slug)}
        >
          {isConnecting ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            t("connect")
          )}
        </Button>
      )}
    </div>
  );
}

// ─── Composio Drawer ─────────────────────────────────────────────────────────

// Matches the server-side clamp in /api/connections; asking for more just
// got silently reduced to this anyway.
const DRAWER_PAGE_SIZE = 50;

function ComposioDrawer({
  open,
  onClose,
  onConnect,
  onDisconnect,
  connectingSlug,
}: {
  open: boolean;
  onClose: () => void;
  onConnect: (slug: string) => void;
  onDisconnect: (id: string) => void;
  connectingSlug: string | null;
}) {
  const t = useTranslations("MCP");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [toolkits, setToolkits] = useState<ComposioToolkit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPage = useCallback(
    async ({ cursor, append }: { cursor?: string; append: boolean }) => {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      try {
        const params = new URLSearchParams({
          paginate: "true",
          limit: String(DRAWER_PAGE_SIZE),
        });
        if (debouncedSearch.trim())
          params.set("search", debouncedSearch.trim());
        if (cursor) params.set("nextCursor", cursor);

        const res = await fetch(`/api/connections?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load toolkits");

        const data: {
          toolkits: ComposioToolkit[];
          nextCursor?: string | null;
        } = await res.json();

        setToolkits((prev) =>
          append ? [...prev, ...(data.toolkits ?? [])] : (data.toolkits ?? []),
        );
        setNextCursor(data.nextCursor ?? null);
      } catch {
        toast.error(t("failedToLoadApps"));
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [debouncedSearch],
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 350);
  };

  useEffect(() => {
    if (!open) {
      setSearch("");
      setDebouncedSearch("");
      setToolkits([]);
      setNextCursor(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    fetchPage({ append: false });
  }, [fetchPage, open]);

  return (
    <Drawer
      handleOnly
      open={open}
      direction="top"
      onOpenChange={(o) => !o && onClose()}
    >
      <DrawerPortal>
        <DrawerContent className="max-h-[90vh] w-full rounded-none flex flex-col overflow-hidden p-4 md:p-6">
          <DrawerTitle className="sr-only">{t("connectTools")}</DrawerTitle>
          <DrawerDescription className="sr-only" />

          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-lg font-semibold flex-1">
              {t("connectTools")}
            </h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>

          <div className="relative mb-4" data-vaul-no-drag>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={t("searchApps")}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto" data-vaul-no-drag>
            {isLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {Array.from({ length: 24 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[112px] rounded-xl border border-border bg-secondary/20 animate-pulse"
                  />
                ))}
              </div>
            ) : toolkits.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">
                {search.trim()
                  ? `No apps found for "${search}"`
                  : "No apps available"}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                  {toolkits.map((toolkit) => (
                    <ComposioDrawerCard
                      key={toolkit.slug}
                      toolkit={toolkit}
                      onConnect={onConnect}
                      onDisconnect={onDisconnect}
                      isConnecting={connectingSlug === toolkit.slug}
                    />
                  ))}
                </div>
                {nextCursor && (
                  <div className="flex justify-center pt-2 pb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isLoadingMore}
                      onClick={() =>
                        fetchPage({ cursor: nextCursor, append: true })
                      }
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="size-3 mr-1 animate-spin" />
                          {t("loading")}
                        </>
                      ) : (
                        t("loadMore")
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}

// ─── Connected App Card ───────────────────────────────────────────────────────

// Compact vertical card so connected apps sit in a responsive grid
// (3-up on mobile, 5-up on desktop) instead of stacking full-width.
function ConnectedAppCard({
  toolkit,
  onDisconnect,
}: {
  toolkit: ComposioToolkit;
  onDisconnect: (id: string) => void;
}) {
  const t = useTranslations("MCP");
  return (
    <div className="relative flex flex-col items-center gap-2 p-3 rounded-xl border border-green-500/30 bg-green-500/5 hover:bg-green-500/10 transition-all">
      <span className="absolute top-2 right-2 size-2 rounded-full bg-green-500" />
      <div className="size-9 rounded-lg overflow-hidden flex items-center justify-center bg-background border border-border shrink-0 mt-1">
        {toolkit.logo ? (
          <img
            src={toolkit.logo}
            alt={toolkit.name}
            className="size-7 object-contain"
          />
        ) : (
          <Plug className="size-4 text-muted-foreground" />
        )}
      </div>
      <p className="text-xs font-medium text-center leading-tight line-clamp-2">
        {toolkit.name}
      </p>
      <Button
        size="sm"
        variant="ghost"
        className="w-full text-[11px] h-6 px-2 text-muted-foreground hover:text-destructive"
        onClick={() =>
          toolkit.connectedAccountId && onDisconnect(toolkit.connectedAccountId)
        }
      >
        {t("disconnect")}
      </Button>
    </div>
  );
}

// ─── Connect Tools Teaser (shown when no apps connected) ─────────────────────

function ConnectToolsTeaser({ onOpenDrawer }: { onOpenDrawer: () => void }) {
  const t = useTranslations("MCP");
  // This branch only renders when nothing is connected, so the five preview
  // logos are fetched here. Handing them down from the dashboard would mean
  // loading the whole toolkit catalog on every visit just in case the user
  // has no apps — which is what made this page take seconds to paint.
  const { data } = useSWR<{ toolkits: ComposioToolkit[] }>(
    "/api/connections?paginate=true&limit=5",
    fetcher,
    { revalidateOnFocus: false, errorRetryCount: 0 },
  );
  const preview = (data?.toolkits ?? []).slice(0, 5);

  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 rounded-2xl border border-dashed border-border bg-secondary/20 text-center">
      {preview.length > 0 && (
        <div className="flex -space-x-3">
          {preview.map((toolkit, index) => (
            <div
              key={toolkit.slug}
              className="size-10 rounded-full bg-background border-2 border-background overflow-hidden flex items-center justify-center shadow-sm"
              style={{ zIndex: preview.length - index }}
            >
              {toolkit.logo ? (
                <img
                  src={toolkit.logo}
                  alt={toolkit.name}
                  className="size-7 object-contain"
                />
              ) : (
                <Plug className="size-4 text-muted-foreground" />
              )}
            </div>
          ))}
          <div
            className="size-10 rounded-full bg-secondary border-2 border-background flex items-center justify-center shadow-sm text-xs font-medium text-muted-foreground"
            style={{ zIndex: 0 }}
          >
            250+
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-sm font-semibold">{t("noToolsConnected")}</p>
        <p className="text-xs text-muted-foreground max-w-xs">
          {t("noToolsConnectedHint")}
        </p>
      </div>

      <Button size="sm" onClick={onOpenDrawer}>
        <Zap className="size-3.5 mr-1.5" />
        {t("connectFirstTool")}
      </Button>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function MCPDashboard({ message }: { message?: string }) {
  const t = useTranslations("MCP");
  const { data: session } = authClient.useSession();
  const { data: mcpList, isLoading, isValidating, mutate } = useMcpList();

  // Connected-only: this page renders the user's connected apps and nothing
  // else. The default mode walks Composio's full ~250-toolkit catalog server
  // side, then throws all but these away.
  const {
    data: composioData,
    isLoading: isLoadingComposio,
    mutate: mutateComposio,
  } = useComposioConnections(undefined, { connectedOnly: true });

  const connectedToolkits = useMemo(
    () => (composioData?.toolkits ?? []).filter((t) => t.isConnected),
    [composioData],
  );

  const { myMcps, sharedMcps } = useMemo(() => {
    if (!mcpList) return { myMcps: [], sharedMcps: [] };
    const owned = mcpList.filter((s) => s.userId === session?.user?.id);
    const shared = mcpList.filter(
      (s) => s.userId !== session?.user?.id && s.visibility === "public",
    );
    return { myMcps: owned, sharedMcps: shared };
  }, [mcpList, session?.user?.id]);

  const sortedMyMcps = useMemo(
    () => [...myMcps].sort((a, b) => a.name.localeCompare(b.name)),
    [myMcps],
  );

  const sortedSharedMcps = useMemo(
    () => [...sharedMcps].sort((a, b) => a.name.localeCompare(b.name)),
    [sharedMcps],
  );

  const [showValidating, setShowValidating] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [connectingSlug, setConnectingSlug] = useState<string | null>(null);

  const handleComposioConnect = useCallback(async (slug: string) => {
    setConnectingSlug(slug);
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkit: slug }),
      });
      if (!res.ok) throw new Error("Failed to start OAuth");
      const { redirectUrl } = await res.json();
      window.location.href = redirectUrl;
    } catch (error: any) {
      toast.error(error.message ?? t("failedToConnectApp"));
      setConnectingSlug(null);
    }
  }, []);

  const handleComposioDisconnect = useCallback(
    async (connectedAccountId: string) => {
      try {
        const res = await fetch("/api/connections/disconnect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectedAccountId }),
        });
        if (!res.ok) throw new Error("Failed to disconnect");
        await mutateComposio();
      } catch (error: any) {
        toast.error(error.message ?? t("failedToDisconnect"));
      }
    },
    [mutateComposio],
  );

  const particle = useMemo(
    () => (
      <>
        <div className="absolute opacity-30 pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <LightRays className="bg-transparent" />
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-t from-background to-50% to-transparent z-20" />
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-l from-background to-20% to-transparent z-20" />
        </div>
        <div className="absolute pointer-events-none top-0 left-0 w-full h-full z-10 fade-in animate-in duration-5000">
          <div className="w-full h-full bg-gradient-to-r from-background to-20% to-transparent z-20" />
        </div>
      </>
    ),
    [],
  );

  useEffect(() => {
    if (isValidating) {
      setShowValidating(false);
      const timerId = setTimeout(() => setShowValidating(true), 500);
      return () => clearTimeout(timerId);
    }
    setShowValidating(false);
  }, [isValidating]);

  useEffect(() => {
    if (message) {
      toast(<p className="whitespace-pre-wrap break-all">{message}</p>, {
        id: "mcp-list-message",
      });
    }
  }, []);

  return (
    <>
      {particle}
      <ScrollArea className="h-full w-full z-40">
        <div className="pt-8 flex-1 relative flex flex-col gap-4 px-8 max-w-3xl h-full mx-auto pb-8">
          {/* ── Header ── */}
          <div className="flex items-center pb-8">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {t("title")}
              {showValidating && isValidating && !isLoading && (
                <Loader2 className="size-4 animate-spin" />
              )}
            </h1>
            <div className="flex-1" />

            <div className="flex items-center gap-3">
              {/* Decorative logo stack — non-interactive, design feature only */}
              {connectedToolkits.length > 0 && (
                <div className="flex -space-x-2 pointer-events-none select-none">
                  {connectedToolkits.slice(0, 5).map((toolkit, index) => (
                    <div
                      key={toolkit.slug}
                      className="relative rounded-full bg-background border border-border p-1"
                      style={{ zIndex: 5 - index }}
                    >
                      {toolkit.logo ? (
                        <img
                          src={toolkit.logo}
                          alt=""
                          className="size-3.5 object-contain"
                        />
                      ) : (
                        <Plug className="size-3.5 text-muted-foreground" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Connect Tools — opens Composio drawer */}
              <Button
                className="font-semibold"
                onClick={() => setDrawerOpen(true)}
              >
                <Zap className="size-3.5" />
                Connect Tools
              </Button>
            </div>
          </div>

          {/* ── Drawer (always rendered so state is preserved) ── */}
          <ComposioDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onConnect={handleComposioConnect}
            onDisconnect={handleComposioDisconnect}
            connectingSlug={connectingSlug}
          />

          {/* ── Content ── */}
          {isLoading ? (
            <div className="flex flex-col gap-4">
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-60 w-full" />
              <Skeleton className="h-60 w-full" />
            </div>
          ) : (
            <div className="flex flex-col gap-10 mb-4 z-20">
              {/* Connected Apps OR teaser */}
              {isLoadingComposio ? (
                <Skeleton className="h-32 w-full" />
              ) : connectedToolkits.length > 0 ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">
                      {t("connectedApps")}
                    </h2>
                    <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                      {connectedToolkits.length}
                    </span>
                    <div className="flex-1 h-px bg-border" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-muted-foreground h-7 px-2"
                      onClick={() => setDrawerOpen(true)}
                    >
                      <Plug className="size-3 mr-1" />
                      {t("addMore")}
                    </Button>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
                    {connectedToolkits.map((toolkit) => (
                      <ConnectedAppCard
                        key={toolkit.slug}
                        toolkit={toolkit}
                        onDisconnect={handleComposioDisconnect}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <ConnectToolsTeaser onOpenDrawer={() => setDrawerOpen(true)} />
              )}

              {/* Developer Section — always visible */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">
                    {t("developerSection")}
                  </h2>
                  <div className="flex-1 h-px bg-border" />
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {/* Create tile — always present */}
                  <Link href="/mcp/create">
                    <Card className="relative bg-secondary overflow-hidden cursor-pointer hover:bg-input transition-colors h-[196px]">
                      <div className="absolute inset-0 w-full h-full opacity-50" />
                      <CardHeader>
                        <CardTitle>
                          <h1 className="text-lg font-bold">
                            {t("newServer")}
                          </h1>
                        </CardTitle>
                      </CardHeader>
                    </Card>
                  </Link>
                  {sortedMyMcps.map((item) => (
                    <McpShareableCard
                      key={item.id}
                      item={item}
                      isOwner
                      onAuthSuccess={async () => {
                        await mutate();
                      }}
                      onVisibilityChange={async (visibility) => {
                        try {
                          const response = await fetch(`/api/mcp/${item.id}`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ visibility }),
                          });
                          if (response.ok) await mutate();
                        } catch (error) {
                          console.error("Failed to update visibility:", error);
                        }
                      }}
                      onDelete={async () => {
                        try {
                          const response = await fetch(`/api/mcp/${item.id}`, {
                            method: "DELETE",
                          });
                          if (response.ok) await mutate();
                        } catch (error) {
                          console.error("Failed to delete server:", error);
                        }
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Shared MCP Servers */}
              {sortedSharedMcps.length > 0 && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-semibold">
                      {t("sharedServers")}
                    </h2>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {sortedSharedMcps.map((item) => (
                      <McpShareableCard
                        key={item.id}
                        item={item}
                        isOwner={false}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </>
  );
}
