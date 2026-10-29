"use client";

import { useWorkflowStore } from "@/app/store/workflow.store";
import { DefaultNode } from "@/components/workflow/default-node";
import { WorkflowPanel } from "@/components/workflow/workflow-panel";
import {
  ReactFlow,
  Background,
  Panel,
  Edge,
  applyNodeChanges,
  OnNodesChange,
  OnEdgesChange,
  applyEdgeChanges,
  addEdge,
  OnConnect,
  OnSelectionChangeFunc,
  NodeMouseHandler,
  IsValidConnection,
  Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { DBWorkflow } from "app-types/workflow";
import { extractWorkflowDiff } from "lib/ai/workflow/extract-workflow-diff";
import {
  convertUIEdgeToDBEdge,
  convertUINodeToDBNode,
} from "lib/ai/workflow/shared.workflow";
import { NodeKind, UINode } from "lib/ai/workflow/workflow.interface";
import { wouldCreateCycle } from "lib/ai/workflow/would-create-cycle";
import { createDebounce, fetcher, generateUUID } from "lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { safe } from "ts-safe";

const nodeTypes = {
  default: DefaultNode,
};

const fitViewOptions = {
  duration: 500,
  padding: 1,
};

export default function Workflow({
  initialNodes,
  initialEdges,
  workflowId,
  hasEditAccess,
}: {
  workflowId: string;
  initialNodes: UINode[];
  hasEditAccess?: boolean;
  initialEdges: Edge[];
}) {
  const { init, addProcess, processIds } = useWorkflowStore();
  const debounce = useMemo(() => createDebounce(), []);
  const [nodes, setNodes] = useState<UINode[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const isProcessing = useMemo(
    () => processIds.length > 0,
    [processIds.length],
  );
  const { data: workflow } = useSWR<DBWorkflow>(
    `/api/workflow/${workflowId}`,
    fetcher,
    {
      onSuccess: (workflow) => {
        init(workflow, hasEditAccess);
      },
    },
  );
  const [activeNodeIds, setActiveNodeIds] = useState<string[]>([]);

  const snapshot = useRef({ nodes: initialNodes, edges: initialEdges });

  const editable = useMemo(() => {
    return !isProcessing && hasEditAccess && !workflow?.isPublished;
  }, [isProcessing, hasEditAccess, workflow?.isPublished]);

  const save = async () => {
    if (workflow?.isPublished) return;

    const diff = extractWorkflowDiff(snapshot.current, { nodes, edges });

    if (
      diff.deleteEdges.length ||
      diff.deleteNodes.length ||
      diff.updateEdges.length ||
      diff.updateNodes.length
    ) {
      const stop = addProcess();
      await safe()
        .map(() => saveWorkflow(workflowId, diff))
        .ifOk(() => {
          snapshot.current = {
            edges,
            nodes,
          };
        })
        .ifFail(() => {
          window.location.reload();
        })
        .watch(stop)
        .unwrap();
    }
  };

  const selectedNode = useMemo(() => {
    return nodes.findLast((node) => node.selected);
  }, [nodes]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      if (!editable) {
        setNodes((nds) => {
          let updatedNodes = nds;
          changes.forEach((change) => {
            if (change.type === "select") {
              updatedNodes = applyNodeChanges(
                [change],
                updatedNodes,
              ) as UINode[];
            } else if (change.type === "replace" && "item" in change) {
              const newNode = change.item as UINode;
              updatedNodes = updatedNodes.map((node) => {
                if (node.id === change.id) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      runtime: newNode.data.runtime,
                    },
                  };
                }
                return node;
              });
            }
          });
          return updatedNodes;
        });
        return;
      }
      setNodes((nds) => applyNodeChanges(changes, nds) as UINode[]);
    },
    [editable],
  );
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      if (!editable) return;
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [editable],
  );
  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!editable) return;
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            id: generateUUID(),
          },
          eds,
        ),
      );
    },
    [editable],
  );

  const onSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes }) => {
      setActiveNodeIds(selectedNodes.map((node) => node.id));
    },
    [],
  );
  const onNodeMouseEnter: NodeMouseHandler = useCallback((_, node) => {
    setActiveNodeIds((prev) => {
      return prev.includes(node.id) ? prev : [...prev, node.id];
    });
  }, []);

  const onNodeMouseLeave: NodeMouseHandler = useCallback((_, node) => {
    setActiveNodeIds((prev) => prev.filter((id) => id !== node.id));
  }, []);

  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      if (!editable) return false;
      if (connection.source === connection.target) return false;
      return !wouldCreateCycle(connection as Connection, edges as Connection[]);
    },
    [editable, edges],
  );

  const { errorIds, runningIds, successIds } = useMemo(() => {
    return nodes.reduce(
      (acc, prev) => {
        if (prev.data.runtime?.status === "fail") {
          acc.errorIds.push(prev.id);
        }
        if (prev.data.runtime?.status === "running") {
          acc.runningIds.push(prev.id);
        }
        if (prev.data.runtime?.status === "success") {
          acc.successIds.push(prev.id);
        }
        return acc;
      },
      {
        errorIds: [] as string[],
        runningIds: [] as string[],
        successIds: [] as string[],
      },
    );
  }, [nodes]);

  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      const isConnected =
        activeNodeIds.includes(edge.source) ||
        activeNodeIds.includes(edge.target);

      const isErrorEdge =
        errorIds.includes(edge.target) &&
        (successIds.includes(edge.source) || errorIds.includes(edge.source));
      const isRunningEdge =
        runningIds.includes(edge.target) && successIds.includes(edge.source);
      const isSuccessEdge =
        successIds.includes(edge.target) &&
        (successIds.includes(edge.source) || runningIds.includes(edge.source));
      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: isErrorEdge
            ? "var(--destructive)"
            : isRunningEdge || isSuccessEdge
              ? "#05df72"
              : isConnected
                ? "oklch(62.3% 0.214 259.815)"
                : undefined,
          strokeWidth: 2,
          transition: "stroke 0.3s",
        },
        animated: runningIds.includes(edge.source),
      };
    });
  }, [edges, activeNodeIds, errorIds, runningIds]);

  useEffect(() => {
    const debounceDelay =
      snapshot.current.nodes.length !== nodes.length ||
      snapshot.current.edges.length !== edges.length
        ? 200
        : 10000;
    debounce(save, debounceDelay);
  }, [nodes, edges]);

  useEffect(() => {
    setNodes((nds) => {
      return nds.map((node) => {
        if (node.data.kind === NodeKind.Input && !node.selected) {
          return { ...node, selected: true };
        }
        return node;
      });
    });
  }, []);

  useEffect(() => {
    init(workflow, hasEditAccess);
  }, [workflow, hasEditAccess]);

  return (
    <div className="w-full h-full relative text-de text-gree-4">
      <ReactFlow
        fitView
        deleteKeyCode={null}
        nodes={nodes}
        maxZoom={1.4}
        minZoom={0.1}
        edges={styledEdges}
        multiSelectionKeyCode={null}
        id={workflowId}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={onSelectionChange}
        isValidConnection={isValidConnection}
        onConnect={onConnect}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        fitViewOptions={fitViewOptions}
      >
        <Background gap={12} size={0.6} />
        <Panel position="top-right" className="z-20!">
          {workflow && (
            <WorkflowPanel
              hasEditAccess={hasEditAccess}
              addProcess={addProcess}
              onSave={save}
              selectedNode={selectedNode}
              workflow={workflow}
              isProcessing={isProcessing}
            />
          )}
        </Panel>
        <Panel
          position="top-left"
          className="h-full w-full m-0! pointer-events-none!"
        >
          <div className="z-10 absolute inset-0 w-full h-1/12 bg-gradient-to-b to-90% from-background to-transparent  pointer-events-none" />
          <div className="z-10 absolute inset-0 w-1/12 h-full bg-gradient-to-r from-background to-transparent  pointer-events-none" />
          <div className="z-10 absolute left-0 bottom-0 w-full h-1/12 bg-gradient-to-t from-background to-transparent  pointer-events-none" />
          <div className="z-10 absolute right-0 bottom-0 w-1/12 h-full bg-gradient-to-l from-background to-transparent  pointer-events-none" />
        </Panel>
      </ReactFlow>
    </div>
  );
}

function saveWorkflow(
  workflowId: string,
  diff: ReturnType<typeof extractWorkflowDiff>,
) {
  return fetch(`/api/workflow/${workflowId}/structure`, {
    method: "POST",
    body: JSON.stringify({
      nodes: diff.updateNodes.map((node) =>
        convertUINodeToDBNode(workflowId, node),
      ),
      edges: diff.updateEdges.map((edge) =>
        convertUIEdgeToDBEdge(workflowId, edge),
      ),
      deleteNodes: diff.deleteNodes.map((node) => node.id),
      deleteEdges: diff.deleteEdges.map((edge) => edge.id),
    }),
  }).then((res) => {
    if (res.status >= 400) {
      throw new Error(String(res.statusText || res.status || "Error"));
    }
  });
}
