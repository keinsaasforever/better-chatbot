import { Edge, useReactFlow } from "@xyflow/react";
import {
  ConditionNodeData,
  NodeKind,
  UINode,
} from "lib/ai/workflow/workflow.interface";
import { ReactNode, useCallback, useMemo } from "react";
import { Label } from "ui/label";
import { NodeIcon } from "./node-icon";
import { Button } from "ui/button";
import { PlusIcon, Unlink } from "lucide-react";
import { NodeSelect } from "./node-select";
import { useUpdate } from "@/hooks/use-update";
import { createAppendNode } from "./create-append-node";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

interface NextNodeInfoProps {
  node: UINode;
  onSelectNode(nodeId: string): void;
}

export function NextNodeInfo({ node, onSelectNode }: NextNodeInfoProps) {
  const t = useTranslations();
  const { addNodes, addEdges, updateNode, getEdges, getNodes, setEdges } =
    useReactFlow();
  const nodes = getNodes() as UINode[];
  const edges = getEdges();
  const onDisconnected = useCallback(
    (edge: Edge) => {
      setEdges(edges.filter((e) => e.id !== edge.id));
    },
    [edges],
  );

  const nextNodes = useMemo(() => {
    const connectedEdges = edges.filter((edge) => edge.source === node.id);

    const nextNodes = connectedEdges.map((edge) => {
      return {
        node: nodes.find((n) => n.id === edge.target)!,
        edge,
      };
    });
    return nextNodes;
  }, [edges, nodes]);

  const update = useUpdate();
  const appendNode = useCallback(
    (kind: NodeKind, partialEdge?: Partial<Edge>) => {
      const { node: newNode, edge: newEdge } = createAppendNode({
        sourceNode: node,
        kind,
        edge: partialEdge,
        allNodes: nodes,
        allEdges: edges,
      });
      addNodes([newNode]);
      if (newEdge) {
        addEdges([newEdge]);
      }
      update(() => {
        updateNode(node.id, {
          selected: false,
        });
      });
    },
    [node.id, nodes, edges, addNodes],
  );
  return (
    <div className="flex flex-col w-full text-muted-foreground">
      <Label className="text-foreground">{t("Workflow.nextNode")}</Label>
      <p className="my-2 text-xs">{t("Workflow.nextNodeDescription")}</p>
      {node.data.kind === NodeKind.Condition ? (
        <ConditionNodeDataConnector
          node={node}
          nextNodes={nextNodes}
          onDisconnected={onDisconnected}
          appendNode={appendNode}
          onSelectNode={onSelectNode}
        />
      ) : (
        <NextNodeConnector
          node={node}
          nextNodes={nextNodes}
          onDisconnected={onDisconnected}
          appendNode={appendNode}
          onSelectNode={onSelectNode}
        />
      )}
    </div>
  );
}

interface NodeConnectorProps {
  onDisconnected: (edge: Edge) => void;
  appendNode: (kind: NodeKind, edge?: Partial<Edge>) => void;
  onSelectNode: (id: string) => void;
  node: UINode;
  nextNodes: {
    node: UINode;
    edge: Edge;
  }[];
  label?: ReactNode;
}

function ConditionNodeDataConnector({
  node,
  onDisconnected,
  appendNode,
  onSelectNode,
  nextNodes,
}: NodeConnectorProps) {
  const data = node.data as ConditionNodeData;
  const { ifNextNodes, elseNextNodes, elseIfNextNodes } = useMemo(() => {
    const ifNextNodes = nextNodes.filter(
      (n) => n.edge.sourceHandle === data.branches.if.id,
    );
    const elseNextNodes = nextNodes.filter(
      (n) => n.edge.sourceHandle === data.branches.else.id,
    );
    const elseIfNextNodes = (data.branches.elseIf ?? []).map((brach) => {
      return nextNodes.filter((n) => n.edge.sourceHandle === brach.id);
    });
    return { ifNextNodes, elseNextNodes, elseIfNextNodes };
  }, [nextNodes, node.data]);

  return (
    <div className="flex flex-col gap-4">
      <NextNodeConnector
        node={node}
        label={
          <div className="font-bold text-center py-1">
            <span className="text-blue-500">IF</span> CASE 1
          </div>
        }
        nextNodes={ifNextNodes}
        onDisconnected={onDisconnected}
        appendNode={(kind) =>
          appendNode(kind, { sourceHandle: data.branches.if.id })
        }
        onSelectNode={onSelectNode}
      />
      {elseIfNextNodes.map((n, i) => {
        return (
          <NextNodeConnector
            key={i}
            node={node}
            label={
              <div className="font-bold text-center py-1">
                <span className="text-blue-500">ELSE IF</span> CASE {i + 2}
              </div>
            }
            nextNodes={n}
            onDisconnected={onDisconnected}
            appendNode={(kind) =>
              appendNode(kind, { sourceHandle: data.branches.elseIf![i].id })
            }
            onSelectNode={onSelectNode}
          />
        );
      })}

      <NextNodeConnector
        node={node}
        label={
          <div className="font-bold text-center py-1">
            <span className="text-blue-500">ELSE</span> CASE{" "}
            {elseIfNextNodes.length + 2}
          </div>
        }
        nextNodes={elseNextNodes}
        onDisconnected={onDisconnected}
        appendNode={(kind) =>
          appendNode(kind, { sourceHandle: data.branches.else.id })
        }
        onSelectNode={onSelectNode}
      />
    </div>
  );
}

function NextNodeConnector({
  node,
  nextNodes,
  onDisconnected,
  appendNode,
  onSelectNode,
  label,
}: NodeConnectorProps) {
  const t = useTranslations();
  return (
    <div className="flex w-full">
      <div className="py-1">
        <div className="border p-[7px] rounded-lg flex items-center">
          <NodeIcon type={node.data.kind} />
        </div>
      </div>
      <div className="py-1">
        <div className="py-[7px] flex items-center">
          <div className="w-6 h-6 flex items-center">
            <div className="h-2 w-0.5 bg-border rounded-r" />
            <div className="w-full h-[1px] bg-border" />
            <div className="h-2 w-0.5 bg-border rounded-l" />
          </div>
        </div>
      </div>

      <div className="text-xs flex-1 min-w-0 gap-1 bg-background rounded-lg p-1 flex flex-col">
        {label}
        {nextNodes.map((n) => {
          return (
            <div
              className="w-full group cursor-pointer hover:bg-secondary transition-colors gap-2 border p-1.5 rounded-lg bg-card flex items-center"
              key={n.node.data.name}
              onClick={onSelectNode?.bind(null, n.node.data.id)}
            >
              <NodeIcon type={n.node.data.kind} />
              {n.node.data.name}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="hover:border-destructive flex transition-colors ml-auto gap-1 border rounded  p-1 items-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDisconnected(n.edge);
                    }}
                  >
                    <Unlink className="size-3 group-hover:text-destructive" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("Workflow.unlink")}</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        <NodeSelect onChange={appendNode}>
          <Button
            size={"lg"}
            variant="ghost"
            className="data-[state=open]:bg-secondary! text-xs w-full text-muted-foreground border border-dashed justify-start"
          >
            <PlusIcon className="size-3" />
            <span>{t("Workflow.addNextNode")}</span>
          </Button>
        </NodeSelect>
      </div>
    </div>
  );
}
