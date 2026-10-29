"use client";
import { appStore } from "@/app/store";
import { Edge } from "@xyflow/react";
import { createUINode } from "lib/ai/workflow/create-ui-node";
import {
  LLMNodeData,
  NodeKind,
  UINode,
} from "lib/ai/workflow/workflow.interface";
import { generateUniqueKey, generateUUID } from "lib/utils";

/**
 * Creates a new workflow node and connects it to an existing source node.
 * This function handles:
 * - Generating unique node names and IDs
 * - Positioning the new node relative to the source
 * - Creating the connecting edge between nodes
 * - Setting appropriate default configurations
 *
 * @param params - Configuration for creating the new node
 * @returns Object containing the new node and optional connecting edge
 */
export function createAppendNode({
  sourceNode,
  kind,
  edge,
  allNodes,
  allEdges,
}: {
  sourceNode: UINode;
  kind: NodeKind;
  edge?: Partial<Edge>;
  allNodes: UINode[];
  allEdges: Edge[];
}): { node: UINode; edge?: Edge } {
  const connectors = allEdges
    .filter((edge) => edge.source === sourceNode.id)
    .map((v) => v.target);

  const connectedNodes = allNodes.filter((node) =>
    connectors.includes(node.id),
  );

  const maxY = Math.max(
    ...connectedNodes.map(
      (node) => node.position.y + (node.measured?.height ?? 0),
    ),
  );

  const names = allNodes.map((node) => node.data.name as string);
  const name = generateUniqueKey(kind.toUpperCase(), names);

  const node = createUINode(kind, {
    name,
    position: {
      x: sourceNode.position.x + 300 * 1.2,
      y: !connectedNodes.length ? sourceNode.position.y : maxY + 80,
    },
  });

  if (kind === NodeKind.LLM) {
    (node.data as LLMNodeData).model = appStore.getState().chatModel! ?? {};
  }
  if (kind === NodeKind.Note) {
    return {
      node,
    };
  }

  return {
    node,
    edge: {
      id: generateUUID(),
      source: sourceNode.id,
      target: node.id,
      ...edge,
    },
  };
}
