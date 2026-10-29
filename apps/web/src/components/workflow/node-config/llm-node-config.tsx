import { LLMNodeData, UINode } from "lib/ai/workflow/workflow.interface";

import { SelectModel } from "../../select-model";
import { Button } from "ui/button";
import {
  InfoIcon,
  MessageCirclePlusIcon,
  TrashIcon,
  VariableIcon,
} from "lucide-react";
import { Select, SelectTrigger, SelectContent, SelectItem } from "ui/select";
import { OutputSchemaMentionInput } from "../output-schema-mention-input";
import { Label } from "ui/label";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { appStore } from "@/app/store";
import { Edge, useEdges, useNodes, useReactFlow } from "@xyflow/react";
import { useWorkflowStore } from "@/app/store/workflow.store";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { Separator } from "ui/separator";
import { Switch } from "ui/switch";
import { OutputSchemaEditor } from "../output-schema-editor";
import { defaultLLMNodeOutputSchema } from "lib/ai/workflow/create-ui-node";
import { ObjectJsonSchema7 } from "app-types/util";
import { toAny } from "lib/utils";
import { notify } from "lib/notify";

export const LLMNodeDataConfig = memo(function ({
  data,
}: {
  data: LLMNodeData;
}) {
  const { updateNodeData } = useReactFlow<UINode>();
  const [structuredOutputOpen, setStructuredOutputOpen] = useState(false);
  const t = useTranslations();
  const editable = useWorkflowStore((state) => {
    return (
      state.processIds.length === 0 &&
      state.hasEditAccess &&
      !state.workflow?.isPublished
    );
  });

  const nodes = useNodes() as UINode[];
  const edges = useEdges() as Edge[];

  const model = useMemo(() => {
    return data.model || appStore.getState().chatModel!;
  }, [data.model]);

  const updateMessage = useCallback(
    (index: number, message: Partial<LLMNodeData["messages"][number]>) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as LLMNodeData;
        return {
          messages: prev.messages.map((m, i) => {
            if (i !== index) return m;
            return { ...m, ...message };
          }),
        };
      });
    },
    [data.id],
  );

  const removeMessage = useCallback(
    (index: number) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as LLMNodeData;
        return {
          messages: prev.messages.filter((_, i) => i !== index),
        };
      });
    },
    [data.id],
  );

  const addMessage = useCallback(() => {
    updateNodeData(data.id, (node) => {
      const prev = node.data as LLMNodeData;
      return {
        messages: [...prev.messages, { role: "user" }],
      };
    });
  }, [data.id]);

  useEffect(() => {
    if (!data.model) {
      updateNodeData(data.id, {
        model: appStore.getState().chatModel!,
      });
    }
  }, []);

  const isStructuredOutput = useMemo(() => {
    return data.outputSchema.properties?.answer?.type != "string";
  }, [data.outputSchema]);

  return (
    <div className="flex flex-col gap-2 text-sm h-full px-4 ">
      <Label className="text-sm">Model</Label>
      <SelectModel
        currentModel={model}
        onSelect={(model) => {
          updateNodeData(data.id, {
            model,
          });
        }}
      />

      <div className="flex items-center justify-between">
        <Label className="text-sm">LLM {t("Workflow.outputSchema")}</Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              <Label
                className="text-xs font-normal text-muted-foreground"
                htmlFor="structuredOutput"
              >
                {t("Workflow.structuredOutput")}
              </Label>
              <Switch
                id="structuredOutput"
                onClick={async () => {
                  if (isStructuredOutput) {
                    const ok = await notify.confirm({
                      description: t("Workflow.structuredOutputSwitchConfirm"),
                      okText: t("Workflow.structuredOutputSwitchConfirmOk"),
                      cancelText: t(
                        "Workflow.structuredOutputSwitchConfirmCancel",
                      ),
                    });
                    if (!ok)
                      return updateNodeData(data.id, {
                        outputSchema: structuredClone(
                          defaultLLMNodeOutputSchema,
                        ),
                      });
                  }
                  setStructuredOutputOpen(true);
                }}
                checked={isStructuredOutput}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent className="p-4 whitespace-pre-wrap">
            {t("Workflow.structuredOutputDescription")}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex items-center flex-wrap gap-1">
        {Object.keys(data.outputSchema.properties).flatMap((key) => {
          if (
            key === "answer" &&
            data.outputSchema.properties[key].type === "object"
          ) {
            return Object.keys(
              data.outputSchema.properties[key].properties ?? {},
            ).map((property) => {
              return (
                <div
                  key={`${key}.${property}`}
                  className="flex items-center text-xs px-1.5 py-0.5 bg-secondary rounded-md"
                >
                  <VariableIcon className="size-3.5 text-blue-500" />
                  <span className="font-semibold">{`${key}.${property}`}</span>
                  <span className="text-muted-foreground ml-2">
                    {
                      toAny(
                        data.outputSchema.properties[key].properties![property],
                      )?.type
                    }
                  </span>
                </div>
              );
            });
          }

          return [
            <div
              key={key}
              className="flex items-center text-xs px-1.5 py-0.5 bg-secondary rounded-md"
            >
              <VariableIcon className="size-3.5 text-blue-500" />
              <span className="font-semibold">{key}</span>
              <span className="text-muted-foreground ml-2">
                {data.outputSchema.properties[key].type}
              </span>
            </div>,
          ];
        })}
      </div>

      <Separator className="my-4" />
      <div className="flex items-center justify-between">
        <Label className="text-sm mt-1">Messages</Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="p-1 hover:bg-secondary rounded cursor-pointer">
              <InfoIcon className="size-3" />
            </div>
          </TooltipTrigger>
          <TooltipContent className="p-4 whitespace-pre-wrap">
            {t("Workflow.messagesDescription")}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-2">
        {data.messages.map((message, index) => {
          return (
            <div key={index} className="w-full bg-secondary rounded-md p-2">
              <div className="flex items-center gap-2">
                <Select
                  value={message.role}
                  onValueChange={(value) => {
                    updateMessage(index, {
                      role: value as "user" | "assistant" | "system",
                    });
                  }}
                >
                  <SelectTrigger className="border-none" size={"sm"}>
                    {message.role.toUpperCase()}
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">USER</SelectItem>
                    <SelectItem value="assistant">ASSISTANT</SelectItem>
                    <SelectItem value="system">SYSTEM</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant={"ghost"}
                  size={"icon"}
                  className="ml-auto size-7 hover:bg-destructive/10! hover:text-destructive"
                  onClick={() => removeMessage(index)}
                >
                  <TrashIcon className="size-3 hover:text-destructive" />
                </Button>
              </div>
              <OutputSchemaMentionInput
                currentNodeId={data.id}
                nodes={nodes}
                edges={edges}
                content={message.content}
                editable={editable}
                onChange={(content) => {
                  updateMessage(index, {
                    content,
                  });
                }}
              />
            </div>
          );
        })}

        <Button
          variant={"ghost"}
          size={"icon"}
          className="w-full mt-1 border-dashed border text-muted-foreground"
          onClick={addMessage}
        >
          <MessageCirclePlusIcon className="size-4" />{" "}
          {t("Workflow.addMessage")}
        </Button>
      </div>

      <OutputSchemaEditor
        schema={data.outputSchema?.properties?.answer as ObjectJsonSchema7}
        open={structuredOutputOpen}
        onOpenChange={setStructuredOutputOpen}
        onChange={(schema) => {
          updateNodeData(data.id, {
            outputSchema: {
              ...data.outputSchema,
              properties: {
                ...data.outputSchema.properties,
                answer: schema,
              },
            },
          });
        }}
      >
        <span className="sr-only"></span>
      </OutputSchemaEditor>
    </div>
  );
});
LLMNodeDataConfig.displayName = "LLMNodeDataConfig";

export const LLMNodeDataStack = memo(function ({
  data,
}: { data: LLMNodeData }) {
  if (!data.model) return null;
  const isTextResponse =
    data.outputSchema.properties?.answer?.type === "string";
  return (
    <div className="flex flex-col gap-1 px-4 mt-4">
      <div className="border bg-input text-[10px] rounded px-2 py-1 flex items-center gap-1">
        <span className="font-semibold">{data.model.model}</span>
        <VariableIcon className="size-3.5 text-blue-500 ml-auto" />
        <span className="text-xs text-muted-foreground ">
          {isTextResponse ? "text" : "object"}
        </span>
      </div>
    </div>
  );
});
LLMNodeDataStack.displayName = "LLMNodeDataStack";
