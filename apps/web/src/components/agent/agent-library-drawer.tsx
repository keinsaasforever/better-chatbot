"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useShallow } from "zustand/shallow";
import { toast } from "sonner";
import { X, Plus, ArrowUpRight, Loader2, Search } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerPortal,
  DrawerTitle,
} from "ui/drawer";
import { Button } from "ui/button";
import { Input } from "ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "ui/card";
import { Avatar, AvatarImage } from "ui/avatar";
import { appStore } from "@/app/store";
import {
  PRESET_AGENTS,
  type PresetCategory,
  type PresetAgent,
} from "lib/ai/agent/presets";
import type { AgentSummary } from "app-types/agent";
import { fetcher } from "lib/utils";
import useSWR from "swr";

/** Display order. Not every category necessarily has presets. */
const CATEGORY_ORDER: PresetCategory[] = [
  "Sales",
  "Marketing",
  "Admin",
  "Finance",
  "Legal",
];

/**
 * Only categories that actually have presets get a tab.
 *
 * The list used to be hardcoded and had drifted from the data: "Legal" was
 * missing, so those presets could not be reached through the library at all,
 * while "Marketing" and "Finance" showed permanently empty tabs. Deriving it
 * keeps the two in step as presets are added.
 */
const CATEGORIES = CATEGORY_ORDER.filter((category) =>
  PRESET_AGENTS.some((preset) => preset.category === category),
);

// ── Individual preset card ─────────────────────────────────────────────────

function PresetCard({
  preset,
  presetIdToAgentId,
  onAdded,
}: {
  preset: PresetAgent;
  presetIdToAgentId: Map<string, string>;
  onAdded: (presetId: string, agentId: string) => void;
}) {
  const router = useRouter();
  const appStoreMutate = appStore(useShallow((state) => state.mutate));
  const [isLoading, setIsLoading] = useState(false);
  const agentId = presetIdToAgentId.get(preset.presetId);
  const isOwned = !!agentId;

  const handleAdd = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/agent/from-preset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId: preset.presetId }),
      });
      if (!res.ok) throw new Error("Failed to add agent");
      const { agentId: newAgentId } = await res.json();
      onAdded(preset.presetId, newAgentId);
    } catch {
      toast.error("Failed to add agent");
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpen = () => {
    if (agentId) {
      appStoreMutate({ openAgentLibrary: false });
      router.push(`/agent/${agentId}`);
    }
  };

  return (
    <Card className="flex flex-col h-full hover:border-primary/40 transition-colors">
      <CardHeader className="shrink gap-y-0 pb-3">
        <CardTitle className="flex gap-3 items-center min-w-0">
          <div
            style={{ backgroundColor: preset.icon?.style?.backgroundColor }}
            className="p-2 rounded-lg flex items-center justify-center ring ring-background border shrink-0"
          >
            <Avatar className="size-6">
              <AvatarImage src={preset.icon?.value} />
            </Avatar>
          </div>
          <span className="truncate font-medium text-sm">{preset.name}</span>
        </CardTitle>
      </CardHeader>

      <CardContent className="grow flex flex-col gap-4 pt-0">
        <CardDescription className="text-xs line-clamp-3 break-words">
          {preset.description}
        </CardDescription>

        <div className="mt-auto">
          {isOwned ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs gap-1"
              onClick={handleOpen}
            >
              Open
              <ArrowUpRight className="size-3" />
            </Button>
          ) : (
            <Button
              size="sm"
              className="w-full text-xs gap-1"
              disabled={isLoading}
              onClick={handleAdd}
            >
              {isLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <>
                  <Plus className="size-3" />
                  Add to my agents
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Grids ──────────────────────────────────────────────────────────────────

/** Name and description are what someone browsing the library reads. */
export function matchesPresetQuery(preset: PresetAgent, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    preset.name.toLowerCase().includes(needle) ||
    preset.description.toLowerCase().includes(needle)
  );
}

function PresetGrid({
  presets,
  presetIdToAgentId,
  onAdded,
  emptyTitle,
  emptyHint,
}: {
  presets: PresetAgent[];
  presetIdToAgentId: Map<string, string>;
  onAdded: (presetId: string, agentId: string) => void;
  emptyTitle: string;
  emptyHint: string;
}) {
  if (presets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
        <p className="text-sm">{emptyTitle}</p>
        <p className="text-xs">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {presets.map((preset) => (
        <PresetCard
          key={preset.presetId}
          preset={preset}
          presetIdToAgentId={presetIdToAgentId}
          onAdded={onAdded}
        />
      ))}
    </div>
  );
}

function CategoryGrid({
  category,
  presetIdToAgentId,
  onAdded,
}: {
  category: PresetCategory;
  presetIdToAgentId: Map<string, string>;
  onAdded: (presetId: string, agentId: string) => void;
}) {
  return (
    <PresetGrid
      presets={PRESET_AGENTS.filter((p) => p.category === category)}
      presetIdToAgentId={presetIdToAgentId}
      onAdded={onAdded}
      emptyTitle="No agents in this category yet."
      emptyHint="Check back soon — more are on the way."
    />
  );
}

// ── Drawer ─────────────────────────────────────────────────────────────────

export function AgentLibraryDrawer() {
  const [open, appStoreMutate] = appStore(
    useShallow((state) => [state.openAgentLibrary, state.mutate]),
  );

  const { data: myAgents, mutate: mutateAgents } = useSWR<AgentSummary[]>(
    open ? "/api/agent?filters=mine" : null,
    fetcher,
  );

  // Build a map of presetId -> agentId from the user's existing agents
  // The tuple annotation matters: without it `.map` yields string[][], which
  // does not match Map's entries overload, and both this map and the merged
  // one below fall back to Map<unknown, unknown>.
  const serverMap = new Map<string, string>(
    (myAgents ?? [])
      .filter((a): a is AgentSummary & { presetId: string } => !!a.presetId)
      .map((a): [string, string] => [a.presetId, a.id]),
  );

  // Track locally added presets so the UI updates instantly without a full refetch
  const [locallyAdded, setLocallyAdded] = useState<Map<string, string>>(
    new Map(),
  );
  const presetIdToAgentId = new Map<string, string>([
    ...serverMap,
    ...locallyAdded,
  ]);

  const [query, setQuery] = useState("");
  const isSearching = query.trim().length > 0;
  const searchResults = useMemo(
    () => PRESET_AGENTS.filter((preset) => matchesPresetQuery(preset, query)),
    [query],
  );

  const handleAdded = (presetId: string, agentId: string) => {
    setLocallyAdded((prev) => new Map([...prev, [presetId, agentId]]));
    mutateAgents();
  };

  const reset = () => {
    setLocallyAdded(new Map());
    setQuery("");
  };

  const handleClose = () => {
    appStoreMutate({ openAgentLibrary: false });
    reset();
  };

  return (
    <Drawer
      handleOnly
      open={open}
      direction="top"
      onOpenChange={(isOpen) => {
        appStoreMutate({ openAgentLibrary: isOpen });
        if (!isOpen) reset();
      }}
    >
      <DrawerPortal>
        <DrawerContent
          style={{ userSelect: "text" }}
          className="max-h-[100vh]! w-full h-full rounded-none flex flex-col overflow-hidden p-4 md:p-6"
        >
          {/* Header row */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold">Agent Library</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Pre-built agents ready to add to your workspace
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              aria-label="Close library"
            >
              <X />
            </Button>
          </div>

          <DrawerTitle className="sr-only">Agent Library</DrawerTitle>
          <DrawerDescription className="sr-only" />

          {/* Search spans the whole library: an agent someone is looking for is
              rarely in the category tab they happen to be on, and the tabs were
              the only way to browse. A query therefore replaces the tabs with a
              flat result grid rather than filtering within one category. */}
          <div className="relative mb-6 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search agents"
              aria-label="Search agents"
              className="pl-9"
            />
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-h-0">
            {isSearching ? (
              <div className="flex-1 overflow-y-auto">
                <PresetGrid
                  presets={searchResults}
                  presetIdToAgentId={presetIdToAgentId}
                  onAdded={handleAdded}
                  emptyTitle={`No agents match "${query.trim()}".`}
                  emptyHint="Try a different word, or clear the search to browse by category."
                />
              </div>
            ) : (
              <Tabs
                defaultValue={CATEGORIES[0]}
                className="flex-1 flex flex-col min-h-0"
              >
                <TabsList className="w-fit mb-6">
                  {CATEGORIES.map((cat) => (
                    <TabsTrigger key={cat} value={cat}>
                      {cat}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <div className="flex-1 overflow-y-auto">
                  {CATEGORIES.map((cat) => (
                    <TabsContent key={cat} value={cat} className="mt-0">
                      <CategoryGrid
                        category={cat}
                        presetIdToAgentId={presetIdToAgentId}
                        onAdded={handleAdded}
                      />
                    </TabsContent>
                  ))}
                </div>
              </Tabs>
            )}
          </div>
        </DrawerContent>
      </DrawerPortal>
    </Drawer>
  );
}
