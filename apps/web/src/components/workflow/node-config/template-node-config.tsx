"use client";

import { TemplateNodeData, UINode } from "lib/ai/workflow/workflow.interface";
import { useEdges, useNodes, useReactFlow } from "@xyflow/react";
import { useCallback, memo } from "react";
import { Label } from "ui/label";

import { OutputSchemaMentionInput } from "../output-schema-mention-input";

import { InfoIcon } from "lucide-react";

import { TipTapMentionJsonContent } from "app-types/util";

import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useTranslations } from "next-intl";
import { useWorkflowStore } from "@/app/store/workflow.store";

interface TemplateNodeConfigProps {
  data: TemplateNodeData;
}

export const TemplateNodeConfig = memo(function TemplateNodeConfig({
  data,
}: TemplateNodeConfigProps) {
  const t = useTranslations();
  const { updateNodeData } = useReactFlow<UINode>();
  const nodes = useNodes() as UINode[];
  const edges = useEdges();
  const editable = useWorkflowStore((state) => {
    return (
      state.processIds.length === 0 &&
      state.hasEditAccess &&
      !state.workflow?.isPublished
    );
  });

  const handleTemplateChange = useCallback(
    (template: TipTapMentionJsonContent) => {
      updateNodeData(data.id, {
        template: { type: "tiptap", tiptap: template },
      });
    },
    [data.id, updateNodeData],
  );

  return (
    <div className="flex flex-col gap-2 text-sm px-4 ">
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-sm mt-1">{t("Workflow.template")}</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="p-1 hover:bg-secondary rounded cursor-pointer">
                <InfoIcon className="size-3" />
              </div>
            </TooltipTrigger>
            <TooltipContent
              side="left"
              align="center"
              className="p-4 whitespace-pre-wrap"
            >
              {t("Workflow.templateDescription")}
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="w-full bg-secondary rounded-md p-2">
          <OutputSchemaMentionInput
            className="min-h-48"
            currentNodeId={data.id}
            nodes={nodes}
            edges={edges}
            content={data.template.tiptap}
            onChange={handleTemplateChange}
            editable={editable}
          />
        </div>
      </div>
    </div>
  );
});
