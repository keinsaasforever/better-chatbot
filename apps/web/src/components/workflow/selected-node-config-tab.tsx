import { NodeKind, UINode } from "lib/ai/workflow/workflow.interface";
import { useReactFlow } from "@xyflow/react";
import { NodeIcon } from "./node-icon";
import { Input } from "ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";
import { MoreHorizontalIcon, XIcon } from "lucide-react";
import { NodeContextMenuContent } from "./node-context-menu-content";
import { Textarea } from "ui/textarea";
import { Separator } from "ui/separator";
import { InputNodeDataConfig } from "./node-config/input-node-config";
import { OutputNodeDataConfig } from "./node-config/output-node-config";
import { LLMNodeDataConfig } from "./node-config/llm-node-config";
import { ConditionNodeDataConfig } from "./node-config/condition-node-config";
import { Label } from "ui/label";
import { NextNodeInfo } from "./next-node-info";
import { nextTick } from "lib/utils";
import { ToolNodeDataConfig } from "./node-config/tool-node-config";
import { HttpNodeConfig } from "./node-config/http-node-config";
import { TemplateNodeConfig } from "./node-config/template-node-config";
import { useTranslations } from "next-intl";

export function SelectedNodeConfigTab({ node }: { node: UINode }) {
  const t = useTranslations();
  const { updateNodeData, updateNode, setNodes } = useReactFlow();

  return (
    <div
      key={node.id}
      className="w-sm h-[85vh] space-y-4 bg-card border rounded-lg shadow-lg overflow-y-auto py-4"
    >
      {/* Header */}
      <div className="px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 w-full">
            <NodeIcon type={node.data.kind} />
            <Input
              maxLength={20}
              onChange={(e) =>
                updateNodeData(node.id, { name: e.target.value })
              }
              value={node.data.name}
              className="bg-transparent border-none px-0 text-lg font-semibold"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="ml-auto rounded hover:bg-secondary cursor-pointer p-1">
                  <MoreHorizontalIcon className="size-3.5" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <NodeContextMenuContent node={node.data} />
              </DropdownMenuContent>
            </DropdownMenu>
            <div
              className="p-1 rounded hover:bg-secondary cursor-pointer"
              onClick={() => {
                setNodes((nodes) => {
                  return nodes.map((n) =>
                    n.id === node.id ? { ...n, selected: false } : n,
                  );
                });
              }}
            >
              <XIcon className="size-3.5" />
            </div>
          </div>
        </div>
        {node.data.kind !== NodeKind.Note && (
          <Textarea
            className="text-xs bg-transparent rounded-none resize-none overflow-y-auto max-h-14 min-h-6 h-6 mt-2 p-0 border-none"
            value={node.data.description}
            onChange={(e) =>
              updateNodeData(node.id, {
                description: e.target.value,
              })
            }
            placeholder={t("Workflow.nodeDescriptionPlaceholder")}
          />
        )}
      </div>

      <Separator className="my-6" />
      <div className="flex-1">
        {node.data.kind === NodeKind.Input ? (
          <InputNodeDataConfig data={node.data} />
        ) : node.data.kind === NodeKind.Output ? (
          <OutputNodeDataConfig data={node.data} />
        ) : node.data.kind === NodeKind.LLM ? (
          <LLMNodeDataConfig data={node.data} />
        ) : node.data.kind === NodeKind.Condition ? (
          <ConditionNodeDataConfig data={node.data} />
        ) : node.data.kind === NodeKind.Tool ? (
          <ToolNodeDataConfig data={node.data} />
        ) : node.data.kind === NodeKind.Http ? (
          <HttpNodeConfig node={node} />
        ) : node.data.kind === NodeKind.Template ? (
          <TemplateNodeConfig data={node.data} />
        ) : node.data.kind === NodeKind.Note ? (
          <div className="h-full flex flex-col gap-2 px-4">
            <Label
              htmlFor="description"
              className="text-muted-foreground text-xs"
            >
              {t("Common.description")}
            </Label>
            <Textarea
              id="description"
              className="resize-none min-h-80 max-h-80 overflow-y-auto"
              value={node.data.description}
              onChange={(e) =>
                updateNodeData(node.id, {
                  description: e.target.value,
                })
              }
            />
          </div>
        ) : null}
      </div>

      {![NodeKind.Output, NodeKind.Note].includes(node.data.kind) && (
        <>
          <Separator className="my-6" />
          <div className="px-4 ">
            <NextNodeInfo
              node={node}
              onSelectNode={(id) => {
                updateNode(node.id, { selected: false });
                nextTick().then(() => updateNode(id, { selected: true }));
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
