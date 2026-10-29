import { Edge, useReactFlow } from "@xyflow/react";
import {
  OutputSchemaSourceKey,
  UINode,
} from "lib/ai/workflow/workflow.interface";
import { memo, useCallback, useMemo, useRef } from "react";

import { VariableSelectContent } from "./variable-select";
import { TipTapMentionJsonContent } from "app-types/util";
import MentionInput from "../mention-input";

import { generateUUID } from "lib/utils";
import { findAvailableSchemaBySource } from "lib/ai/workflow/shared.workflow";
import { VariableMentionItem } from "./variable-mention-item";
import { useToRef } from "@/hooks/use-latest";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "ui/dropdown-menu";

interface OutputSchemaMentionInputProps {
  currentNodeId: string;
  nodes: UINode[];
  edges: Edge[];
  content?: TipTapMentionJsonContent;
  onChange: (content: TipTapMentionJsonContent) => void;
  placeholder?: string;
  editable?: boolean;
  className?: string;
}

export function OutputSchemaMentionInput({
  currentNodeId,
  content,
  onChange,
  editable,
  className,
}: OutputSchemaMentionInputProps) {
  const { getNodes, getEdges } = useReactFlow<UINode>();
  const latestContent = useToRef<TipTapMentionJsonContent>(content!);
  const handleChange = useCallback(
    ({ json }: { json: TipTapMentionJsonContent }) => {
      onChange(json);
    },
    [],
  );

  const onRemove = useCallback((id: string) => {
    const newContent = structuredClone(latestContent.current);
    newContent.content.some((item) => {
      if (item?.content?.length) {
        const targetIndex = item.content.findIndex(
          (item) => item.type == "mention" && item.attrs.id === id,
        );
        if (targetIndex !== -1) {
          item.content.splice(targetIndex, 1);
          return true;
        }
        return false;
      }
    });
    onChange(newContent);
  }, []);

  const MentionItem = useCallback(
    ({ id, label }: { id: string; label: string }) => {
      const item = JSON.parse(label) as OutputSchemaSourceKey;

      const nodes = getNodes();
      const edges = getEdges();

      const labelData = findAvailableSchemaBySource({
        nodeId: currentNodeId,
        source: item,
        nodes: nodes.map((node) => node.data),
        edges,
      });

      const handleRemove = () => onRemove(id);

      return (
        <VariableMentionItem
          className="max-w-60"
          {...labelData}
          onRemove={handleRemove}
        />
      );
    },
    [],
  );

  const Suggestion = useMemo(
    () => outputSchemaMentionInputSuggestionBuilder(currentNodeId),
    [currentNodeId],
  );

  return (
    <MentionInput
      className={className}
      suggestionChar="/"
      disabled={!editable}
      content={content}
      onChange={handleChange}
      MentionItem={MentionItem}
      Suggestion={Suggestion}
    />
  );
}

const outputSchemaMentionInputSuggestionBuilder = (
  nodeId: string,
): React.FC<{
  onClose: () => void;
  onSelectMention: (item: { label: string; id: string }) => void;
  top: number;
  left: number;
}> =>
  memo(function OutputSchemaMentionInputSuggestion({
    onSelectMention,
    top,
    left,
    onClose,
  }) {
    const mentionRef = useRef<HTMLDivElement>(null);

    return (
      <div
        className="fixed z-50"
        style={{
          top,
          left,
        }}
      >
        <DropdownMenu open={true} onOpenChange={onClose}>
          <DropdownMenuTrigger className="sr-only" />
          <DropdownMenuContent ref={mentionRef} align="start" side="top">
            <VariableSelectContent
              onClose={onClose}
              currentNodeId={nodeId}
              onChange={(item) => {
                onSelectMention({
                  id: generateUUID(),
                  label: JSON.stringify({
                    nodeId: item.nodeId,
                    path: item.path,
                  }),
                });
              }}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  });
