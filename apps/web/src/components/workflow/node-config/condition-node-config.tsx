"use client";

import { Handle, Position, useNodes, useReactFlow } from "@xyflow/react";
import {
  ConditionNodeData,
  NodeKind,
  OutputSchemaSourceKey,
  UINode,
} from "lib/ai/workflow/workflow.interface";
import { PlusIcon, TrashIcon } from "lucide-react";
import { Button } from "ui/button";
import { Separator } from "ui/separator";
import { VariableSelect } from "../variable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "ui/select";

import { VariableMentionItem } from "../variable-mention-item";
import {
  BooleanConditionOperator,
  ConditionBranch,
  ConditionOperator,
  ConditionRule,
  getFirstConditionOperator,
  NumberConditionOperator,
  StringConditionOperator,
} from "lib/ai/workflow/condition";
import { useCallback, useMemo, useState } from "react";
import { findJsonSchemaByPath } from "lib/ai/workflow/shared.workflow";
import { Badge } from "ui/badge";
import { cn, generateUUID } from "lib/utils";
import { NodeSelect } from "../node-select";
import { useUpdate } from "@/hooks/use-update";
import { createAppendNode } from "../create-append-node";
import { useTranslations } from "next-intl";
import { Input } from "ui/input";

export function ConditionNodeDataConfig({
  data,
}: {
  data: ConditionNodeData;
}) {
  const t = useTranslations();
  const { updateNodeData, setEdges, getEdges } = useReactFlow();

  const updateIfBranch = useCallback(
    (branch: ConditionBranch) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as ConditionNodeData;
        return {
          branches: { ...prev.branches, if: branch },
        };
      });
    },
    [data.id],
  );

  const updateElseIfBranch = useCallback(
    (index: number, branch: ConditionBranch) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as ConditionNodeData;
        return {
          branches: {
            ...prev.branches,
            elseIf: prev.branches.elseIf?.map((item, i) =>
              i == index ? branch : item,
            ) ?? [branch],
          },
        };
      });
    },
    [data.id],
  );

  const addElseIfBranch = useCallback(() => {
    updateNodeData(data.id, (node) => {
      const prev = node.data as ConditionNodeData;
      return {
        branches: {
          ...prev.branches,
          elseIf: [
            ...(prev.branches.elseIf ?? []),
            {
              id: generateUUID(),
              type: "elseIf",
              conditions: [],
              logicalOperator: "AND",
            },
          ],
        },
      };
    });
  }, [data.id]);

  const removeElseIfBranch = useCallback(
    (index: number) => {
      const edges = getEdges();
      const connectedEdges = edges
        .filter((edge) => edge.sourceHandle == data.branches.elseIf![index].id)
        .map((edge) => edge.id);
      if (connectedEdges.length) {
        setEdges(edges.filter((edge) => !connectedEdges.includes(edge.id)));
      }
      updateNodeData(data.id, (node) => {
        const prev = node.data as ConditionNodeData;
        return {
          branches: {
            ...prev.branches,
            elseIf: prev.branches.elseIf?.filter((_, i) => i !== index),
          },
        };
      });
    },
    [data.id, data.branches.elseIf?.length],
  );

  return (
    <div className="flex flex-col gap-2 text-sm h-full">
      <div className="flex flex-col gap-2 px-4">
        <ConditionBranchItem
          currentNodeId={data.id}
          caseNumber={1}
          branch={data.branches.if}
          onChange={updateIfBranch}
          type={"if"}
        />
      </div>
      <Separator className="my-2" />
      <div className="flex flex-col gap-2 px-4">
        {!data.branches.elseIf?.length && (
          <>
            <p className="font-bold text-xs mb-2 text-blue-500">ELSE IF</p>
            <p className="text-xs ml-12 text-muted-foreground">
              {t("Workflow.elseIfDescription")}
            </p>
          </>
        )}
        <div className="flex flex-col">
          {data.branches.elseIf?.map((branch, i) => (
            <div key={i}>
              {i > 0 && <Separator className="my-2" />}
              <ConditionBranchItem
                currentNodeId={data.id}
                caseNumber={i + 2}
                branch={branch}
                onChange={(branch) => updateElseIfBranch(i, branch)}
                onDelete={() => removeElseIfBranch(i)}
                type={"else If"}
              />
            </div>
          ))}
        </div>
        <Button
          variant={"secondary"}
          className={cn("w-full")}
          onClick={addElseIfBranch}
        >
          <PlusIcon className="size-4" />
          ELSE IF
        </Button>
      </div>
      <Separator className="my-2" />
      <div className="px-4">
        <div className="font-bold text-xs flex mb-2">
          <p className="w-12 text-blue-500">ELSE</p>
          <span className="ml-1 text-muted-foreground">
            CASE {(data.branches.elseIf?.length ?? 0) + 2}
          </span>
        </div>
        <p className="text-xs ml-12 text-muted-foreground ">
          {t("Workflow.elseDescription")}
        </p>
      </div>
    </div>
  );
}
ConditionNodeDataConfig.displayName = "ConditionNodeDataConfig";

interface ConditionBranchProps {
  currentNodeId: string;
  branch: ConditionBranch;
  onChange: (branch: ConditionBranch) => void;
  caseNumber: number;
  onDelete?: () => void;
  type: "if" | "else If" | "else";
}

function ConditionBranchItem({
  currentNodeId,
  branch,
  onChange,
  caseNumber,
  onDelete,
  type,
}: ConditionBranchProps) {
  const { getNode } = useReactFlow<UINode>();
  const nodes = useNodes() as UINode[];
  const t = useTranslations();
  const addCondition = useCallback(
    (source: OutputSchemaSourceKey) => {
      const node = getNode(source.nodeId)!;

      const sourceSchema = findJsonSchemaByPath(
        node.data.outputSchema,
        source.path,
      );
      onChange({
        ...branch,
        conditions: [
          ...branch.conditions,
          {
            source,
            operator: getFirstConditionOperator(
              sourceSchema?.type as "string" | "number" | "boolean",
            ),
            value: "",
          },
        ],
      });
    },
    [branch, onChange],
  );

  const updateCondition = useCallback(
    (index: number, condition: ConditionRule) => {
      onChange({
        ...branch,
        conditions: branch.conditions.map((item, i) =>
          i == index ? condition : item,
        ),
      });
    },
    [branch, onChange],
  );

  const removeCondition = useCallback(
    (index: number) => {
      onChange({
        ...branch,
        conditions: branch.conditions.filter((_, i) => i !== index),
      });
    },
    [branch, onChange],
  );

  return (
    <div className="flex flex-col gap-1 relative">
      <div className="font-bold text-xs flex mb-2">
        <p className="w-12 text-blue-500">{type?.toUpperCase()}</p>
        <span className="ml-1 text-muted-foreground">CASE {caseNumber}</span>
      </div>
      {branch.conditions.length > 0 && (
        <div className="flex">
          <div className="flex flex-col min-w-12">
            {branch.conditions.length > 1 && (
              <>
                <div className="flex-1 w-full flex justify-end items-end">
                  <div className="h-[calc(100%-1rem)] w-1/2 border-l border-dashed border-t rounded-tl-full"></div>
                </div>
                <div className="text-xs text-center my-1 pr-1">
                  <button
                    onClick={() =>
                      onChange({
                        ...branch,
                        logicalOperator:
                          branch.logicalOperator == "AND" ? "OR" : "AND",
                      })
                    }
                    className="w-11 hover:bg-secondary hover:text-foreground bg-primary text-primary-foreground rounded-md px-2 py-1"
                  >
                    {branch.logicalOperator}
                  </button>
                </div>
                <div className="flex-1 w-full flex justify-end items-start">
                  <div className="h-[calc(100%-1rem)] w-1/2 border-l border-dashed border-b rounded-bl-full"></div>
                </div>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1">
            {branch.conditions.map((condition, i) => (
              <div className="flex" key={i}>
                <div className="flex-1">
                  <ConditionRuleItem
                    currentNodeId={currentNodeId}
                    nodes={nodes}
                    item={condition}
                    onChange={(condition) => updateCondition(i, condition)}
                  />
                </div>
                <div className="px-1 ">
                  <Button
                    variant={"ghost"}
                    size={"icon"}
                    onClick={() => removeCondition(i)}
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center">
        <VariableSelect
          currentNodeId={currentNodeId}
          onChange={(source) => {
            addCondition(source);
          }}
          allowedTypes={["number", "boolean", "string"]}
        >
          <Badge
            variant={"secondary"}
            className="ml-12 cursor-pointer hover:bg-input py-2 px-4"
          >
            <PlusIcon className="size-4" /> {t("Workflow.addCondition")}
          </Badge>
        </VariableSelect>

        {onDelete && (
          <Button
            variant={"ghost"}
            className="ml-auto text-xs mr-7"
            onClick={onDelete}
          >
            <TrashIcon className="size-3.5" />
            {t("Common.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}

interface ConditionRuleProps {
  currentNodeId: string;
  nodes: UINode[];
  item: ConditionRule;
  onChange: (item: ConditionRule) => void;
}

function ConditionRuleItem({
  currentNodeId,
  nodes,
  item,
  onChange,
}: ConditionRuleProps) {
  const target = useMemo(() => {
    const node = nodes.find((node) => node.data.id === item.source.nodeId);
    if (!node) {
      return {
        nodeName: "Not Found",
        path: item.source.path,
        notFound: true,
      };
    }
    return {
      nodeName: node.data.name,
      path: item.source.path,
    };
  }, [item, nodes]);

  const itemType = useMemo(() => {
    const node = nodes.find((node) => node.data.id === item.source.nodeId);
    if (!node) {
      return "string";
    }
    return findJsonSchemaByPath(node.data.outputSchema, item.source.path)?.type;
  }, [item, nodes]);

  const operatorItems = useMemo(() => {
    let operatorItems: Record<string, string> = StringConditionOperator;
    if (itemType == "number") operatorItems = NumberConditionOperator;
    if (itemType == "boolean") operatorItems = BooleanConditionOperator;
    return Object.entries(operatorItems).map(([key, value]) => ({
      label: key,
      value,
    }));
  }, [itemType]);

  return (
    <div className="flex flex-col bg-secondary rounded-lg p-1">
      <div className="flex items-center">
        <VariableSelect
          currentNodeId={currentNodeId}
          onChange={(source) => {
            onChange({
              ...item,
              source,
            });
          }}
        >
          <div>
            <VariableMentionItem
              className="py-2 max-w-38 w-38"
              nodeName={target.nodeName}
              path={target.path}
              type={itemType as string}
            />
          </div>
        </VariableSelect>
        <div className="h-4 px-2 ml-auto">
          <Separator orientation="vertical" />
        </div>
        <Select
          defaultValue={item.operator}
          onValueChange={(value) =>
            onChange({
              ...item,
              value: undefined,
              operator: value as ConditionOperator,
            })
          }
        >
          <SelectTrigger className="text-xs border-none w-24">
            <SelectValue placeholder="Operator" />
          </SelectTrigger>
          <SelectContent>
            {operatorItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {itemType == "string" || itemType == "number" ? (
        <>
          <Separator className="my-1" />
          <Input
            value={String(item.value || "")}
            autoFocus
            className="text-xs py-1 px-2 focus:outline-none bg-transparent border-none"
            type="text"
            onChange={(e) => onChange({ ...item, value: e.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}

export function ConditionNodeDataOutputStack({
  data,
}: {
  data: ConditionNodeData;
}) {
  const [sourceHandle, setSourceHandle] = useState("");

  const update = useUpdate();

  const { addNodes, addEdges, updateNode, getNodes, getEdges } = useReactFlow();

  const appendNode = (kind: NodeKind) => {
    if (!sourceHandle) return;
    setSourceHandle("");
    const allNodes = getNodes() as UINode[];
    const { node: newNode, edge: newEdge } = createAppendNode({
      sourceNode: allNodes.find((node) => node.data.id === data.id)!,
      kind,
      allNodes,
      edge: {
        sourceHandle,
      },
      allEdges: getEdges(),
    });

    addNodes([newNode]);
    if (newEdge) {
      addEdges([newEdge]);
    }
    update(() => {
      updateNode(data.id, {
        selected: false,
      });
    });
  };

  return (
    <div className="mt-2">
      <div className="flex flex-col gap-2">
        <ConditionHandle
          type="if"
          id={data.branches.if.id}
          caseNumber={1}
          onMouseUp={() => {
            setSourceHandle(data.branches.if.id);
          }}
        />
        <NodeSelect
          onChange={appendNode}
          open={Boolean(sourceHandle)}
          onOpenChange={(open) => {
            if (!open) {
              setSourceHandle("");
            }
          }}
        >
          <PlusIcon className={"sr-only"} />
        </NodeSelect>

        {data.branches.elseIf?.map((branch, i) => (
          <ConditionHandle
            type="elseIf"
            key={branch.id}
            id={branch.id}
            caseNumber={i + 2}
            onMouseUp={() => {
              setSourceHandle(branch.id);
            }}
          />
        ))}
        <ConditionHandle
          type="else"
          id={data.branches.else.id}
          caseNumber={(data.branches.elseIf?.length ?? 0) + 2}
          onMouseUp={() => {
            setSourceHandle(data.branches.else.id);
          }}
        />
      </div>
    </div>
  );
}

function ConditionHandle({
  type,
  id,
  caseNumber,
  onMouseUp,
}: {
  type: "if" | "elseIf" | "else";
  id: string;
  caseNumber?: number;
  onMouseUp?: () => void;
}) {
  return (
    <div className="relative">
      <Handle
        type="source"
        position={Position.Right}
        className={cn(
          "z-10 border-none! bg-blue-500! h-5! w-5! rounded-full! -right-0! flex items-center justify-center",
        )}
        id={id}
        isConnectable={true}
        onMouseUp={onMouseUp}
      >
        <div className="pointer-events-none">
          <PlusIcon className={cn("size-4 text-white stroke-4")} />
        </div>
      </Handle>
      <div className="px-4">
        <div className="px-2 w-full text-xs py-1 font-bold bg-input border rounded-xs flex">
          <span className="text-blue-500">{type.toUpperCase()}</span>
          {caseNumber && (
            <span className="text-muted-foreground ml-auto">
              CASE {caseNumber}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
