"use client";

import {
  InputNodeData,
  WorkflowNodeData,
} from "lib/ai/workflow/workflow.interface";
import { memo, useCallback } from "react";
import {
  Feild,
  EditJsonSchemaFieldPopup,
  getFieldKey,
} from "../../edit-json-schema-field-popup";
import { InfoIcon, PlusIcon, TrashIcon, VariableIcon } from "lucide-react";
import { PencilIcon } from "lucide-react";
import { objectFlow } from "lib/utils";
import { Button } from "ui/button";
import { Label } from "ui/label";
import { useReactFlow } from "@xyflow/react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";

export const InputNodeDataConfig = memo(function ({
  data,
}: {
  data: InputNodeData;
}) {
  const t = useTranslations();
  const { updateNodeData } = useReactFlow();

  const checkRequired = useCallback(
    (key: string) => {
      return data.outputSchema.required?.includes(key);
    },
    [data.outputSchema],
  );

  const addField = useCallback(
    (field: Feild) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as InputNodeData;
        const outputSchema = {
          ...prev.outputSchema,
          properties: {
            ...prev.outputSchema.properties,
            [field.key]: {
              type: field.type,
              enum:
                field.type == "string" && field.enum ? field.enum : undefined,
              description: field.description,
              default: field.defaultValue,
            },
          },
          required: !field.required
            ? prev.outputSchema.required?.filter((k) => k != field.key)
            : Array.from(
                new Set([...(prev.outputSchema.required ?? []), field.key]),
              ),
        };
        return {
          outputSchema,
        };
      });
    },
    [data.id],
  );

  const removeField = useCallback(
    (key: string) => {
      updateNodeData(data.id, (node) => {
        const prev = node.data as InputNodeData;
        const outputSchema = {
          ...prev.outputSchema,
          properties: objectFlow(prev.outputSchema.properties).filter(
            (_, k) => k != key,
          ),
          required: prev.outputSchema.required?.filter((k) => k != key),
        };
        return {
          outputSchema,
        };
      });
    },
    [data.outputSchema],
  );

  return (
    <div className="flex flex-col gap-2 text-sm px-4 ">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{t("Workflow.inputFields")}</Label>

        <Tooltip>
          <TooltipTrigger asChild>
            <div className="p-1 hover:bg-secondary rounded cursor-pointer">
              <InfoIcon className="size-3.5" />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="left"
            align="center"
            className="p-4 text-sm whitespace-pre-wrap break-words"
          >
            {t("Workflow.inputFieldsDescription")}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex flex-col gap-1">
        {Object.entries(data.outputSchema.properties ?? {}).map(
          ([key, value]) => (
            <div
              key={key}
              className="flex items-center gap-1 py-1 px-2 bg-secondary rounded group/item border cursor-pointer"
            >
              <VariableIcon className="size-3 text-blue-500" />

              <span>{key}</span>
              <div className="flex-1" />

              <span className="block group-hover/item:hidden text-xs text-muted-foreground">
                <span className="text-[10px] text-destructive">
                  {checkRequired(key) ? "*" : " "}
                </span>
                {getFieldKey(value)}
              </span>
              <div className="hidden group-hover/item:flex items-center gap-1">
                <EditJsonSchemaFieldPopup
                  editAbleKey={false}
                  field={{
                    key,
                    type: value.type as any,
                    description: value.description,
                    enum: value.enum as string[],
                    required: checkRequired(key),
                    defaultValue: value.default as any,
                  }}
                  onChange={addField}
                >
                  <div className="p-1 text-muted-foreground rounded cursor-pointer hover:bg-input">
                    <PencilIcon className="size-3" />
                  </div>
                </EditJsonSchemaFieldPopup>
                <div
                  onClick={() => removeField(key)}
                  className="p-1 text-destructive rounded cursor-pointer hover:bg-destructive/10"
                >
                  <TrashIcon className="size-3" />
                </div>
              </div>
            </div>
          ),
        )}
        <EditJsonSchemaFieldPopup onChange={addField}>
          <Button
            variant="ghost"
            className="w-full mt-1 border-dashed border text-muted-foreground"
          >
            <PlusIcon /> {t("Workflow.addInputField")}
          </Button>
        </EditJsonSchemaFieldPopup>
      </div>
    </div>
  );
});
InputNodeDataConfig.displayName = "InputNodeDataConfig";

export const OutputSchemaStack = memo(function ({
  data,
}: { data: WorkflowNodeData }) {
  const keys = Object.keys(data.outputSchema?.properties ?? {});
  if (!keys.length) return null;
  return (
    <div className="flex flex-col gap-1 px-4 mt-4">
      {keys.map((v) => {
        const schema = data.outputSchema.properties[v];
        return (
          <div
            className="border bg-input text-[10px] rounded px-2 py-1 flex items-center gap-1"
            key={v}
          >
            <VariableIcon className="size-3 text-blue-500" />
            <span>{v}</span>
            <div className="flex-1" />

            <span className="text-[10px] block group-hover/item:hidden text-xs text-muted-foreground">
              <span className=" text-destructive">
                {data.outputSchema.required?.includes(v) ? "*" : " "}
              </span>
              {getFieldKey(schema)}
            </span>
          </div>
        );
      })}
    </div>
  );
});
OutputSchemaStack.displayName = "OutputSchemaStack";
