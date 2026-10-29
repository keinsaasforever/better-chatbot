import { Edge } from "@xyflow/react";
import { JSONSchema7 } from "json-schema";
import {
  ConditionNodeData,
  OutputNodeData,
  LLMNodeData,
  NodeKind,
  InputNodeData,
  UINode,
  WorkflowNodeData,
  ToolNodeData,
  HttpNodeData,
  TemplateNodeData,
} from "lib/ai/workflow/workflow.interface";
import { cleanVariableName } from "lib/utils";
import { safe } from "ts-safe";
import { findJsonSchemaByPath } from "./shared.workflow";
import { ConditionBranch } from "./condition";

export function validateSchema(key: string, schema: JSONSchema7) {
  const variableName = cleanVariableName(key);
  if (variableName.length === 0) {
    throw new Error("Invalid Variable Name");
  }
  if (variableName.length > 255) {
    throw new Error("Variable Name is too long");
  }
  if (!schema.type) {
    throw new Error("Invalid Schema");
  }
  if (schema.type == "array" || schema.type == "object") {
    const keys = Array.from(Object.keys(schema.properties ?? {}));
    if (keys.length != new Set(keys).size) {
      throw new Error("Output data must have unique keys");
    }
    return keys.every((key) => {
      return validateSchema(key, schema.properties![key] as JSONSchema7);
    });
  }
  return true;
}

type NodeValidate<T> = (context: {
  node: T;
  nodes: UINode[];
  edges: Edge[];
}) => void;

export function allNodeValidate({
  nodes,
  edges,
}: { nodes: UINode[]; edges: Edge[] }):
  | true
  | {
      node?: UINode;
      errorMessage: string;
    } {
  if (!nodes.some((n) => n.data.kind === NodeKind.Input)) {
    return {
      errorMessage: "Input node must be only one",
    };
  }
  if (!nodes.some((n) => n.data.kind === NodeKind.Output)) {
    return {
      errorMessage: "Output node must be only one",
    };
  }

  for (const node of nodes) {
    const result = safe()
      .ifOk(() => nodeValidate({ node: node.data, nodes, edges }))
      .ifFail((err) => {
        return {
          node,
          errorMessage: err.message,
        };
      })
      .unwrap();
    if (result) {
      return result;
    }
  }
  return true;
}

export const nodeValidate: NodeValidate<WorkflowNodeData> = ({
  node,
  nodes,
  edges,
}) => {
  if (
    node.kind != NodeKind.Note &&
    nodes.filter((n) => n.data.name === node.name).length > 1
  ) {
    throw new Error("Node name must be unique");
  }
  switch (node.kind) {
    case NodeKind.Input:
      return inputNodeValidate({ node, nodes, edges });
    case NodeKind.Output:
      return outputNodeValidate({ node, nodes, edges });
    case NodeKind.LLM:
      return llmNodeValidate({ node, nodes, edges });
    case NodeKind.Condition:
      return conditionNodeValidate({ node, nodes, edges });
    case NodeKind.Tool:
      return toolNodeValidate({ node, nodes, edges });
    case NodeKind.Http:
      return httpNodeValidate({ node, nodes, edges });
    case NodeKind.Template:
      return templateNodeValidate({ node, nodes, edges });
  }
};

export const inputNodeValidate: NodeValidate<InputNodeData> = ({
  node,
  edges,
}) => {
  if (!edges.some((e) => e.source === node.id)) {
    throw new Error("Input node must have an edge");
  }
  const outputKeys = Array.from(
    Object.keys(node.outputSchema.properties ?? {}),
  );

  outputKeys.forEach((key) => {
    validateSchema(key, node.outputSchema.properties![key] as JSONSchema7);
  });
};

export const outputNodeValidate: NodeValidate<OutputNodeData> = ({
  node,
  nodes,
  edges,
}) => {
  const names = node.outputData.map((data) => data.key);
  const uniqueNames = [...new Set(names)];
  if (names.length !== uniqueNames.length) {
    throw new Error("Output data must have unique keys");
  }
  node.outputData.forEach((data) => {
    const variableName = cleanVariableName(data.key);
    if (variableName.length === 0) {
      throw new Error("Invalid Variable Name");
    }
    if (variableName.length > 255) {
      throw new Error("Variable Name is too long");
    }
    if (!data.source) throw new Error("Output data must have a source");
    if (data.source.path.length === 0)
      throw new Error("Output data must have a path");
    const sourceNode = nodes.find((n) => n.data.id === data.source?.nodeId);
    if (!sourceNode) throw new Error("Source node not found");
    const sourceSchema = findJsonSchemaByPath(
      sourceNode.data.outputSchema,
      data.source.path,
    );
    if (!sourceSchema) throw new Error("Source schema not found");
  });

  let current: WorkflowNodeData | undefined = node as WorkflowNodeData;
  while (current && current.kind !== NodeKind.Input) {
    const prevNodeId = edges.find((e) => e.target === current!.id)?.source;
    if (!prevNodeId) throw new Error("Prev node must have an edge");
    const prevNode = nodes.find((n) => n.data.id === prevNodeId);
    if (!prevNode) current = undefined;
    else current = prevNode.data as WorkflowNodeData;
  }

  if (current?.kind !== NodeKind.Input)
    throw new Error("Prev node must be a Input node");
};

export const llmNodeValidate: NodeValidate<LLMNodeData> = ({ node }) => {
  if (!node.model) throw new Error("LLM node must have a model");
  node.messages.map((message) => {
    if (!message.role) throw new Error("LLM node must have a role");
    if (!message.content) throw new Error("LLM node must have a content");
  });
  if (node.messages.length === 0)
    throw new Error("LLM node must have a message");
};

export const conditionNodeValidate: NodeValidate<ConditionNodeData> = ({
  node,
}) => {
  const branchValidate = (branch: ConditionBranch) => {
    branch.conditions.forEach((condition) => {
      if (!condition.operator)
        throw new Error("Condition must have a operator");
      if (!condition.source) throw new Error("Condition must have a value");
    });
  };
  [node.branches.if, ...(node.branches.elseIf ?? [])].forEach(branchValidate);
};

export const toolNodeValidate: NodeValidate<ToolNodeData> = ({ node }) => {
  if (!node.tool) throw new Error("Tool node must have a tool");
  if (!node.model) throw new Error("Tool node must have a model");
  if (!node.message) throw new Error("Tool node must have a message");
};

export const httpNodeValidate: NodeValidate<HttpNodeData> = ({ node }) => {
  // Validate URL is provided (can be empty string, but must be defined)
  if (node.url === undefined) {
    throw new Error("HTTP node must have a URL defined");
  }

  // Validate HTTP method
  const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD"];
  if (!validMethods.includes(node.method)) {
    throw new Error(`HTTP method must be one of: ${validMethods.join(", ")}`);
  }

  // Validate timeout if provided
  if (node.timeout !== undefined) {
    if (typeof node.timeout !== "number" || node.timeout <= 0) {
      throw new Error("HTTP timeout must be a positive number");
    }
    if (node.timeout > 300000) {
      // 5 minutes max
      throw new Error("HTTP timeout cannot exceed 300000ms (5 minutes)");
    }
  }

  // Validate headers format
  if (node.headers) {
    for (const header of node.headers) {
      if (!header.key || header.key.trim().length === 0) {
        throw new Error("Header key cannot be empty");
      }
      // Check for duplicate header keys (case insensitive)
      const lowerKey = header.key.toLowerCase();
      const duplicates = node.headers.filter(
        (h) => h.key.toLowerCase() === lowerKey,
      );
      if (duplicates.length > 1) {
        throw new Error(`Duplicate header key: ${header.key}`);
      }
    }
  }

  // Validate query parameters format
  if (node.query) {
    for (const queryParam of node.query) {
      if (!queryParam.key || queryParam.key.trim().length === 0) {
        throw new Error("Query parameter key cannot be empty");
      }
    }
  }

  // Validate body is only used with appropriate methods
  if (
    node.body !== undefined &&
    !["POST", "PUT", "PATCH"].includes(node.method)
  ) {
    throw new Error(`Body is not allowed for ${node.method} requests`);
  }
};

export const templateNodeValidate: NodeValidate<TemplateNodeData> = ({
  node,
}) => {
  // Validate template type
  const validTypes = ["tiptap"]; // Future: add "handlebars"
  if (!validTypes.includes(node.template.type)) {
    throw new Error(`Template type must be one of: ${validTypes.join(", ")}`);
  }

  // Template content can be undefined/empty - that's valid
  // The actual content validation is handled by the TipTap editor
};
