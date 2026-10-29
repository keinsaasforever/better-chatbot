"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrashIcon, VariableIcon } from "lucide-react";
import {
  HttpValue,
  OutputSchemaSourceKey,
} from "lib/ai/workflow/workflow.interface";
import { VariableSelect } from "./variable-select";
import { useReactFlow } from "@xyflow/react";
import { UINode } from "lib/ai/workflow/workflow.interface";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { VariableMentionItem } from "./variable-mention-item";
import { findAvailableSchemaBySource } from "lib/ai/workflow/shared.workflow";
import { useTranslations } from "next-intl";
import { cn, exclude } from "lib/utils";

interface HttpValueInputProps {
  value: HttpValue | undefined;
  onChange: (value: HttpValue | undefined) => void;
  onDelete?: () => void;
  placeholder?: string;
  currentNodeId: string;
  allowedTypes?: string[];
  className?: string;
}

export function HttpValueInput({
  value,
  onChange,
  placeholder,
  currentNodeId,
  allowedTypes = [],
  onDelete,
  className,
}: HttpValueInputProps) {
  const { getNodes, getEdges } = useReactFlow<UINode>();
  const t = useTranslations("Workflow");

  // Check if current value is a variable reference
  const isVariable = value && typeof value === "object" && "nodeId" in value;

  // Get the node name for display if it's a variable
  const getVariable = (sourceKey: OutputSchemaSourceKey) => {
    const data = findAvailableSchemaBySource({
      nodeId: currentNodeId,
      source: sourceKey,
      nodes: getNodes().map((node) => node.data),
      edges: getEdges(),
    });
    return exclude(data, ["type"]);
  };

  const handleLiteralChange = (inputValue: string) => {
    if (inputValue === "") {
      onChange(undefined);
      return;
    }
    onChange(inputValue);
  };

  const handleVariableSelect = (item: {
    nodeId: string;
    path: string[];
    nodeName: string;
    type: string;
  }) => {
    onChange({
      nodeId: item.nodeId,
      path: item.path,
    });
  };

  return (
    <div className={cn("flex items-center gap-1 min-w-0", className)}>
      {isVariable ? (
        <div className="flex-1 min-w-0">
          <VariableMentionItem
            className="py-[7px] text-sm truncate"
            {...getVariable(value as OutputSchemaSourceKey)}
            onRemove={() => onChange(undefined)}
          />
        </div>
      ) : (
        <Input
          className="flex-1 placeholder:text-xs"
          value={value?.toString() || ""}
          onChange={(e) => handleLiteralChange(e.target.value)}
          placeholder={placeholder}
        />
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <VariableSelect
              currentNodeId={currentNodeId}
              onChange={handleVariableSelect}
              allowedTypes={allowedTypes}
            >
              <Button
                variant={isVariable ? "secondary" : "ghost"}
                onPointerDown={(e) => {
                  if (isVariable) {
                    e.preventDefault();
                    onChange(undefined);
                  }
                }}
                size="icon"
                className="data-[state=open]:bg-secondary"
              >
                <VariableIcon className={isVariable ? "text-blue-500" : ""} />
              </Button>
            </VariableSelect>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t("selectVariable")}</p>
        </TooltipContent>
      </Tooltip>
      {onDelete && (
        <Button variant="ghost" size="icon" onClick={onDelete}>
          <TrashIcon />
        </Button>
      )}
    </div>
  );
}
