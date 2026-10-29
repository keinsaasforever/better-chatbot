"use client";

import { OutputNodeData, UINode } from "lib/ai/workflow/workflow.interface";
import { memo, useCallback, useMemo } from "react";

import {
  ChevronDownIcon,
  PlusIcon,
  TrashIcon,
  TriangleAlertIcon,
  VariableIcon,
} from "lucide-react";

import { VariableSelect } from "../variable-select";
import { useReactFlow } from "@xyflow/react";

import { Input } from "ui/input";
import { Button } from "ui/button";
import { cleanVariableName, generateUniqueKey } from "lib/utils";
import { Label } from "ui/label";
import { findJsonSchemaByPath } from "lib/ai/workflow/shared.workflow";
import { useTranslations } from "next-intl";

export const OutputNodeDataConfig = memo(function ({
  data,
}: {
  data: OutputNodeData;
}) {
  const { getNodes, updateNodeData } = useReactFlow();
  const t = useTranslations();
  const outputVariables = useMemo(() => {
    const nodes = getNodes() as UINode[];
    return data.outputData.map(({ key, source }) => {
      const targetNode = nodes.find((node) => node.data.id === source?.nodeId);
      const schema = targetNode
        ? findJsonSchemaByPath(targetNode.data.outputSchema, source?.path ?? [])
        : undefined;
      return {
        key,
        schema,
        path: source?.path ?? [],
        nodeName: targetNode?.data.name,
        nodeId: targetNode?.data.id,
        isNotFound: (source && !targetNode) || (targetNode && !schema),
      };
    });
  }, [data]);

  const updateOutputVariable = useCallback(
    (
      index: number,
      item: { key?: string; source?: { nodeId: string; path: string[] } },
    ) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as OutputNodeData;
        return {
          outputData: prev.outputData.map((v, i) =>
            i === index ? { ...v, ...item } : v,
          ),
        };
      });
    },
    [data.id],
  );
  const deleteOutputVariable = useCallback(
    (index: number) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as OutputNodeData;
        return {
          outputData: prev.outputData.filter((_, i) => i !== index),
        };
      });
    },
    [data.id],
  );

  const addOutputVariable = useCallback(
    (key: string = "") => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as OutputNodeData;
        const newKey = generateUniqueKey(
          key,
          prev.outputData.map((v) => v.key),
        );
        return {
          outputData: [...prev.outputData, { key: newKey, source: undefined }],
        };
      });
    },
    [data.id],
  );

  return (
    <div className="flex flex-col gap-2 text-sm px-4 ">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{t("Workflow.outputVariables")}</Label>
      </div>
      <div className="flex flex-col gap-2">
        {outputVariables.map((item, index) => {
          return (
            <div className="flex items-center gap-1" key={index}>
              <Input
                value={item.key}
                onChange={(e) => {
                  updateOutputVariable(index, {
                    key: cleanVariableName(e.target.value),
                  });
                }}
                className="w-24"
                placeholder="name"
              />
              <VariableSelect
                currentNodeId={data.id}
                onChange={(item) => {
                  updateOutputVariable(index, {
                    source: {
                      nodeId: item.nodeId,
                      path: item.path,
                    },
                  });
                }}
              >
                <div className="flex-1 min-w-0 w-full flex text-[10px] items-center gap-1 p-2.5 border border-input bg-background rounded-lg cursor-pointer">
                  {item.isNotFound ? (
                    <TriangleAlertIcon className="size-3 text-destructive" />
                  ) : (
                    <VariableIcon className="size-3 text-blue-500" />
                  )}

                  <span>{item.nodeName}/</span>
                  <span className="truncate min-w-0 text-blue-500 flex-1">
                    {item.path.join(".")}
                  </span>
                  <span className="text-muted-foreground">
                    {item.schema?.type}
                  </span>

                  <ChevronDownIcon className="size-3 ml-auto" />
                </div>
              </VariableSelect>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteOutputVariable(index)}
              >
                <TrashIcon />
              </Button>
            </div>
          );
        })}
        <Button
          variant="ghost"
          onClick={() => {
            addOutputVariable("text");
          }}
          className="w-full border-dashed border text-muted-foreground"
        >
          <PlusIcon /> {t("Workflow.addOutputVariable")}
        </Button>
      </div>
    </div>
  );
});
OutputNodeDataConfig.displayName = "OutputNodeDataConfig";

export const OutputNodeDataOutputStack = memo(function ({
  data,
}: { data: OutputNodeData }) {
  const { getNodes } = useReactFlow();
  const outputVariables = useMemo(() => {
    const nodes = getNodes() as UINode[];
    return data.outputData.map(({ key, source }) => {
      const targetNode = nodes.find((node) => node.data.id === source?.nodeId);
      const schema = targetNode
        ? findJsonSchemaByPath(targetNode.data.outputSchema, source?.path ?? [])
        : undefined;
      return {
        key,
        schema,
        path: source?.path ?? [],
        nodeName: targetNode?.data.name,
        nodeId: targetNode?.data.id,
        isNotFound: (source && !targetNode) || (targetNode && !schema),
      };
    });
  }, [data.outputSchema]);

  if (!outputVariables.length) return null;
  return (
    <div className="flex flex-col gap-1 px-4 mt-4">
      {outputVariables.map((item, index) => {
        return (
          <div
            className="border bg-input text-[10px] rounded px-2 py-1 flex items-center gap-1"
            key={index}
          >
            <div className="flex-1 min-w-0 w-full flex items-center gap-1">
              {item.isNotFound ? (
                <TriangleAlertIcon className="size-3 text-destructive" />
              ) : (
                <VariableIcon className="size-3 text-blue-500" />
              )}

              <span>{item.nodeName}/</span>
              <span className="truncate min-w-0 text-blue-500 flex-1">
                {item.path.join(".")}
              </span>
              <span className="text-muted-foreground">{item.schema?.type}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
});
OutputNodeDataOutputStack.displayName = "OutputNodeDataOutputStack";
