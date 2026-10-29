"use client";

import {
  Background,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import "@xyflow/react/dist/style.css";
import { computeForceLayout } from "@/lib/project-brain/graph-layout";
import { fetcher } from "@/lib/utils";
import { Focus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Input } from "ui/input";
import { Skeleton } from "ui/skeleton";

type GraphNode = {
  id: string;
  kind: string;
  label: string;
  summary: string | null;
  factCount: number;
  salience: number;
  degree: number;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  confidence: number;
  virtual: boolean;
};

type GraphResponse = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  focus: string | null;
  availableKinds: string[];
};

type LinkRef = {
  type: string;
  label: string;
  confidence: number;
  page: { id: string; kind: string; label: string };
};

type NodeDetail = {
  node: {
    id: string;
    kind: string;
    label: string;
    summary: string | null;
    salience: number;
    aliases: string[];
    mergedFrom: string[];
  };
  facts: Array<{
    id: string;
    key: string;
    value: string;
    confidence: number;
    sourceLabel: string;
  }>;
  links: LinkRef[];
  backlinks: LinkRef[];
};

const KIND_COLORS: Record<string, string> = {
  project: "#0d00e0",
  person: "#e0007a",
  organization: "#7c3aed",
  meeting: "#0891b2",
  task: "#ea580c",
  decision: "#16a34a",
  document: "#64748b",
  topic: "#0369a1",
  tool: "#475569",
  agent: "#9333ea",
  voice: "#0f766e",
};

const CANVAS = { width: 1200, height: 640 };

function groupByType(refs: LinkRef[]) {
  const groups = new Map<string, LinkRef[]>();
  for (const ref of refs) {
    groups.set(ref.type, [...(groups.get(ref.type) ?? []), ref]);
  }
  return [...groups.entries()];
}

export function ProjectKnowledgeGraph({ projectId }: { projectId: string }) {
  const t = useTranslations("Projects.graph");
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const graphKey = `/api/projects/${projectId}/brain/graph${
    focusId ? `?focus=${focusId}&depth=2` : ""
  }`;
  const { data, error, isLoading } = useSWR<GraphResponse>(graphKey, fetcher, {
    revalidateOnFocus: false,
  });

  const { data: detail } = useSWR<NodeDetail>(
    selectedId && !selectedId.startsWith("project:")
      ? `/api/projects/${projectId}/brain/graph/nodes/${selectedId}`
      : null,
    fetcher,
  );

  // Layout once per graph payload; kind filters only hide nodes afterwards
  // so toggling a chip does not reshuffle everything.
  const positions = useMemo(() => {
    if (!data) return new Map<string, { x: number; y: number }>();
    return computeForceLayout(
      data.nodes.map((node) => ({
        id: node.id,
        isHub: node.kind === "project",
        size: Math.min(6, Math.log1p(node.salience + node.degree)),
      })),
      data.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        virtual: edge.virtual,
      })),
      CANVAS,
    );
  }, [data]);

  const adjacency = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const node of data?.nodes ?? [])
      result.set(node.id, new Set([node.id]));
    for (const edge of data?.edges ?? []) {
      result.get(edge.source)?.add(edge.target);
      result.get(edge.target)?.add(edge.source);
    }
    return result;
  }, [data]);

  const activeId = hoveredId ?? selectedId;
  const neighbourhood = activeId ? adjacency.get(activeId) : null;
  const searchNeedle = search.trim().toLowerCase();

  const visibleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const node of data?.nodes ?? []) {
      if (node.kind !== "project" && hiddenKinds.has(node.kind)) continue;
      ids.add(node.id);
    }
    return ids;
  }, [data, hiddenKinds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setNodes(
      (data?.nodes ?? [])
        .filter((node) => visibleIds.has(node.id))
        .map((node) => {
          const color = KIND_COLORS[node.kind] ?? KIND_COLORS.topic;
          const dimmed =
            (neighbourhood && !neighbourhood.has(node.id)) ||
            (searchNeedle && !node.label.toLowerCase().includes(searchNeedle));
          const size =
            1 + Math.min(1, Math.log1p(node.salience + node.degree) / 4);
          return {
            id: node.id,
            position: positions.get(node.id) ?? { x: 0, y: 0 },
            data: {
              label:
                node.kind === "project"
                  ? node.label
                  : `${node.label}${node.factCount ? ` · ${node.factCount}` : ""}`,
            },
            style: {
              borderRadius: 12,
              borderWidth: node.kind === "project" ? 2 : 1,
              borderColor: color,
              fontSize: `${11 * size}px`,
              padding: `${6 * size}px ${10 * size}px`,
              opacity: dimmed ? 0.18 : 1,
              transition: "opacity 160ms",
              background: "var(--card)",
              color: "var(--card-foreground)",
            },
          } satisfies Node;
        }),
    );
  }, [data, visibleIds, neighbourhood, searchNeedle, positions, setNodes]);

  useEffect(() => {
    setEdges(
      (data?.edges ?? [])
        .filter(
          (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
        )
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: edge.virtual ? undefined : edge.label,
          type: "smoothstep",
          animated: false,
          labelStyle: { fontSize: 9, fill: "var(--muted-foreground)" },
          labelBgStyle: { fill: "var(--card)" },
          style: {
            strokeDasharray: edge.virtual ? "4 4" : undefined,
            opacity:
              activeId && edge.source !== activeId && edge.target !== activeId
                ? 0.12
                : edge.virtual
                  ? 0.35
                  : 0.9,
          },
        })),
    );
  }, [data, visibleIds, activeId, setEdges]);

  const toggleKind = (kind: string) =>
    setHiddenKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });

  const selectByName = () => {
    if (!searchNeedle || !data) return;
    const hit = data.nodes.find((node) =>
      node.label.toLowerCase().includes(searchNeedle),
    );
    if (hit) setSelectedId(hit.id);
  };

  if (error) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }

  if (isLoading && !data) return <Skeleton className="h-[640px] w-full" />;

  if (data && !data.nodes.some((node) => node.kind !== "project")) {
    return (
      <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        {t("empty")}
      </p>
    );
  }

  const kinds = (data?.availableKinds ?? []).filter(
    (kind) => kind !== "project",
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") selectByName();
            }}
            placeholder={t("searchPlaceholder")}
            className="h-8 w-56 pl-7 text-xs"
          />
        </div>
        {kinds.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => toggleKind(kind)}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition-opacity ${
              hiddenKinds.has(kind) ? "opacity-40" : ""
            }`}
            style={{ borderColor: KIND_COLORS[kind] ?? KIND_COLORS.topic }}
          >
            <span
              className="mr-1 inline-block size-2 rounded-full"
              style={{ background: KIND_COLORS[kind] ?? KIND_COLORS.topic }}
            />
            {t(`kinds.${kind}`)}
          </button>
        ))}
        {focusId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setFocusId(null)}
          >
            <X className="mr-1 size-3" />
            {t("showAll")}
          </Button>
        )}
        {data?.truncated && (
          <span className="text-xs text-muted-foreground">
            {t("truncated")}
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="h-[640px] overflow-hidden rounded-xl border bg-card">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            fitView
            minZoom={0.15}
            maxZoom={2}
            nodesConnectable={false}
            onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
            onNodeMouseLeave={() => setHoveredId(null)}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
          >
            <Background gap={18} size={1} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        <Card className="h-fit max-h-[640px] overflow-y-auto">
          <CardHeader className="space-y-2">
            <CardTitle className="text-base">
              {detail?.node.label ?? t("title")}
            </CardTitle>
            {detail && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  style={{ borderColor: KIND_COLORS[detail.node.kind] }}
                  className="text-[10px]"
                >
                  {t(`kinds.${detail.node.kind}`)}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 text-[11px]"
                  onClick={() => setFocusId(detail.node.id)}
                  disabled={focusId === detail.node.id}
                >
                  <Focus className="mr-1 size-3" />
                  {t("focus")}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {!selectedId && (
              <p className="text-muted-foreground">{t("selectNode")}</p>
            )}
            {detail?.node.summary && <p>{detail.node.summary}</p>}
            {detail && detail.node.aliases.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("aliases")}: {detail.node.aliases.join(", ")}
              </p>
            )}
            {detail && detail.node.mergedFrom.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("mergedFrom")}: {detail.node.mergedFrom.join(", ")}
              </p>
            )}

            {detail &&
              (detail.links.length > 0 || detail.backlinks.length > 0) && (
                <div className="space-y-2">
                  {[
                    ["links", detail.links] as const,
                    ["backlinks", detail.backlinks] as const,
                  ].map(([key, refs]) =>
                    refs.length ? (
                      <div key={key}>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                          {t(key)}
                        </p>
                        {groupByType(refs).map(([type, group]) => (
                          <div key={type} className="mb-1">
                            <span className="text-[11px] text-muted-foreground">
                              {type.replace(/_/g, " ")}
                            </span>
                            <ul className="ml-2">
                              {group.map((ref) => (
                                <li key={`${type}:${ref.page.id}`}>
                                  <button
                                    type="button"
                                    className="text-left hover:underline"
                                    onClick={() => setSelectedId(ref.page.id)}
                                  >
                                    {ref.page.label}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    ) : null,
                  )}
                </div>
              )}

            {detail && detail.facts.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {t("facts")}
                </p>
                <div className="space-y-2">
                  {detail.facts.map((fact) => (
                    <div
                      key={fact.id}
                      className="rounded-lg border p-2 text-sm"
                    >
                      <p>{fact.value}</p>
                      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <Badge variant="outline" className="text-[10px]">
                          {fact.key}
                        </Badge>
                        <span>{Math.round(fact.confidence * 100)}%</span>
                        <span>{fact.sourceLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
