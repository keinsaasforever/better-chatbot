"use client";

import { Handle, Position, useReactFlow, type NodeProps } from "@xyflow/react";
import { NodeKind, UINode } from "lib/ai/workflow/workflow.interface";
import { cn } from "lib/utils";
import { Loader2Icon, PlusIcon, TriangleAlertIcon } from "lucide-react";

import { memo, useCallback, useEffect, useState } from "react";
import { NodeSelect } from "./node-select";
import { NodeIcon } from "./node-icon";

import { useUpdate } from "@/hooks/use-update";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "ui/context-menu";

import { OutputSchemaStack } from "./node-config/input-node-config";
import { OutputNodeDataOutputStack } from "./node-config/output-node-config";
import { LLMNodeDataStack } from "./node-config/llm-node-config";
import { NodeContextMenuContent } from "./node-context-menu-content";
import { ConditionNodeDataOutputStack } from "./node-config/condition-node-config";
import { createAppendNode } from "./create-append-node";
import { ToolNodeStack } from "./node-config/tool-node-config";
import { Markdown } from "../markdown";
import { HttpNodeDataStack } from "./node-config/http-node-config";

type Props = NodeProps<UINode>;

export const DefaultNode = memo(function DefaultNode({
  data,
  isConnectable,
  selected,
  id,
}: Props) {
  const [openNodeSelect, setOpenNodeSelect] = useState(false);

  const {
    fitView,
    getEdges,
    addNodes,
    getNode,
    getNodes,
    addEdges,
    updateNode,
  } = useReactFlow();
  const update = useUpdate();

  const appendNode = useCallback(
    (kind: NodeKind) => {
      setOpenNodeSelect(false);
      const edges = getEdges();
      const nodes = getNodes() as UINode[];

      const { node: newNode, edge: newEdge } = createAppendNode({
        sourceNode: getNode(data.id)! as UINode,
        kind,
        allNodes: nodes,
        allEdges: edges,
      });
      addNodes([newNode]);
      if (newEdge) {
        addEdges([newEdge]);
      }
      update(() => {
        updateNode(id, {
          selected: false,
        });
      });
    },
    [id, addNodes],
  );

  useEffect(() => {
    if (data.runtime?.isNew) {
      updateNode(id, {
        selected: true,
      });
      const node = getNode(id)!;
      if (node) {
        fitView({
          nodes: [node],
          duration: 500,
          maxZoom: 1.2,
        });
      }
    }
  }, [id]);

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          className={cn(
            "fade-300 group py-4 w-72 relative bg-secondary border-2 hover:bg-input rounded-lg flex flex-col cursor-grab transition-colors",
            data.kind === NodeKind.Note &&
              "bg-card/40 text-primary rounded-none w-md min-h-40 border-input",
            data.kind === NodeKind.Condition && "w-52",
            data.kind !== NodeKind.Note &&
              selected &&
              "border-blue-500 bg-secondary!",
            data.runtime?.status === "fail" && "border-destructive",
            ["success", "running"].includes(data.runtime?.status ?? "") &&
              "border-green-400",
          )}
        >
          <div className="flex items-center gap-2 relative px-4">
            {![NodeKind.Note, NodeKind.Input].includes(data.kind) && (
              <Handle
                id="left"
                type="target"
                className={cn(
                  "h-4! border-none! bg-blue-500! w-[1px]! -left-[4px]! rounded-l-xs! rounded-r-none!",
                  data.runtime?.status === "fail" && "bg-destructive!",
                  ["success", "running"].includes(data.runtime?.status ?? "") &&
                    "bg-green-400!",
                )}
                position={Position.Left}
                isConnectable={isConnectable}
              />
            )}
            <NodeIcon type={data.kind} />
            <div className="font-bold truncate">{data.name}</div>
            {![NodeKind.Note, NodeKind.Output, NodeKind.Condition].includes(
              data.kind,
            ) && (
              <Handle
                type="source"
                onConnect={() => update()}
                position={Position.Right}
                className={cn(
                  "z-10 border-none! -right-0! bg-transparent! w-4! h-4!",
                )}
                id="right"
                isConnectable={isConnectable}
                onMouseUp={() => {
                  setOpenNodeSelect(true);
                }}
              >
                <div className={cn("pointer-events-none relative")}>
                  <div
                    className={cn(
                      "flex w-full h-full z-20 pl-2.5",
                      "group-hover:hidden",
                      selected && "hidden",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-1.5 bg-blue-500 rounded-r-xs",
                        data.runtime?.status === "fail" && "bg-destructive",
                        ["success", "running"].includes(
                          data.runtime?.status ?? "",
                        ) && "bg-green-400",
                      )}
                    ></div>
                  </div>
                  <NodeSelect
                    onChange={appendNode}
                    open={openNodeSelect}
                    onOpenChange={(open) => {
                      setOpenNodeSelect(open);
                    }}
                  >
                    <div
                      className={cn(
                        "items-center justify-center bg-blue-500 rounded-full w-5 h-5 hidden translate-x -translate-y-0.5",
                        "group-hover:flex",
                        selected && "flex",
                      )}
                    >
                      <PlusIcon className={"size-4 text-white stroke-4"} />
                    </div>
                  </NodeSelect>
                </div>
              </Handle>
            )}
            {data.runtime?.status === "fail" ? (
              <div className="ml-auto">
                <TriangleAlertIcon className="size-3 text-destructive" />
              </div>
            ) : data.runtime?.status === "running" ? (
              <div className="ml-auto">
                <Loader2Icon className="size-3 animate-spin" />
              </div>
            ) : null}
          </div>
          <div>
            {data.kind === NodeKind.Input && <OutputSchemaStack data={data} />}
            {data.kind === NodeKind.Output && (
              <OutputNodeDataOutputStack data={data} />
            )}
            {data.kind === NodeKind.LLM && <LLMNodeDataStack data={data} />}
            {data.kind === NodeKind.Condition && (
              <ConditionNodeDataOutputStack data={data} />
            )}
            {data.kind === NodeKind.Tool && <ToolNodeStack data={data} />}
            {data.kind === NodeKind.Http && <HttpNodeDataStack data={data} />}
            {data.description && (
              <div className="px-4 mt-2">
                <div className="text-xs text-muted-foreground">
                  {data.kind === NodeKind.Note ? (
                    <Markdown>{data.description}</Markdown>
                  ) : (
                    <p
                      className={cn(
                        "break-all whitespace-pre-wrap text-sm text-foreground mt-4",
                      )}
                    >
                      {data.description}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="p-2">
        <NodeContextMenuContent node={data} />
      </ContextMenuContent>
    </ContextMenu>
  );
});
