import { Node } from "@xyflow/react";
import { ChatModel } from "app-types/chat";
import { ObjectJsonSchema7, TipTapMentionJsonContent } from "app-types/util";
import { ConditionBranches } from "./condition";
import { JSONSchema7 } from "json-schema";

/**
 * Enum defining all available node types in the workflow system.
 * When adding a new node type:
 * 1. Add the new kind here
 * 2. Create corresponding NodeData type below
 * 3. Implement executor in node-executor.ts
 * 4. Add validation in node-validate.ts
 * 5. Create UI config component in components/workflow/node-config/
 */
export enum NodeKind {
  Input = "input", // Entry point of workflow - receives initial data
  LLM = "llm", // Large Language Model interaction node
  Condition = "condition", // Conditional branching node
  Note = "note", // Documentation/annotation node
  Tool = "tool", // MCP tool execution node
  Http = "http", // HTTP request node
  Template = "template", // Template processing node
  Code = "code", // Code execution node (future implementation)
  Output = "output", // Exit point of workflow - produces final result
}

/**
 * Base interface for all workflow node data.
 * Every node must have these common properties.
 */
export type BaseWorkflowNodeDataData<
  T extends {
    kind: NodeKind;
  },
> = {
  id: string;
  name: string; // unique name within workflow
  description?: string;
  /**
   * Defines the output schema of this node.
   * Other nodes can reference fields from this schema as their inputs.
   * This enables data flow between connected nodes.
   */
  outputSchema: ObjectJsonSchema7;
} & T;

/**
 * Reference to a field from another node's output.
 * Used to create data dependencies between nodes.
 */
export type OutputSchemaSourceKey = {
  nodeId: string; // ID of the source node
  path: string[]; // Path to the specific field in the output (e.g., ["result", "data"])
};

/**
 * MCP (Model Context Protocol) tool definition.
 * Currently only supports MCP tools, but extensible for other tool types.
 */
type MCPTool = {
  type: "mcp-tool";
  serverId: string;
  serverName: string;
};

type DefaultTool = {
  type: "app-tool";
};

/**
 * Workflow tool key that defines available tools for Tool nodes.
 */
export type WorkflowToolKey = {
  id: string; // tool Name
  description: string;
  parameterSchema?: JSONSchema7; // Input schema for the tool
  returnSchema?: JSONSchema7; // Output schema for the tool
} & (MCPTool | DefaultTool);

// Node Data Types - Each node kind has its specific data structure

/**
 * Input node: Entry point of the workflow
 * Receives initial data and passes it to connected nodes
 */
export type InputNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.Input;
}>;

/**
 * Output node: Exit point of the workflow
 * Collects data from previous nodes and produces final result
 */
export type OutputNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.Output;
}> & {
  outputData: {
    key: string; // Key name in final output
    source?: OutputSchemaSourceKey; // Reference to source node's output
  }[];
};

/**
 * Note node: For documentation and annotations
 * Does not affect workflow execution, used for documentation purposes
 */
export type NoteNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.Note;
}>;

/**
 * Tool node: Executes external tools (primarily MCP tools)
 * Can optionally use LLM to generate tool parameters from a message
 */
export type ToolNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.Tool;
  tool?: WorkflowToolKey; // Selected tool to execute
  model: ChatModel; // LLM model for parameter generation
  message?: TipTapMentionJsonContent; // Optional message to generate parameters
}>;

/**
 * LLM node: Interacts with Large Language Models
 * Supports multiple messages and can reference outputs from previous nodes
 */
export type LLMNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.LLM;
}> & {
  model: ChatModel;
  messages: {
    role: "user" | "assistant" | "system";
    content?: TipTapMentionJsonContent; // Can reference other node outputs via mentions
  }[];
};

/**
 * Condition node: Provides conditional branching in workflows
 * Evaluates conditions and routes execution to different paths
 */
export type ConditionNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.Condition;
}> & {
  branches: ConditionBranches; // if-elseIf-else structure for conditional logic
};

/**
 * HTTP request method type
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD";

/**
 * Simple value type that can be a literal string or reference to another node's output
 */
export type HttpValue = string | OutputSchemaSourceKey;

/**
 * HTTP node: Performs HTTP requests to external services
 * Supports all standard HTTP methods with configurable parameters
 */
export type HttpNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.Http;
}> & {
  url?: HttpValue; // Request URL (can reference other node outputs)
  method: HttpMethod; // HTTP method
  headers: {
    key: string;
    value?: HttpValue; // Header value (can reference other node outputs)
  }[]; // Request headers
  query: {
    key: string;
    value?: HttpValue; // Query parameter value (can reference other node outputs)
  }[]; // Query parameters
  body?: HttpValue; // Request body (can reference other node outputs)
  timeout?: number; // Request timeout in milliseconds (default: 30000)
};

/**
 * Template node: Processes text templates with variable substitution
 * Supports different template engines for flexible content generation
 */
export type TemplateNodeData = BaseWorkflowNodeDataData<{
  kind: NodeKind.Template;
}> & {
  template: {
    type: "tiptap";
    tiptap: TipTapMentionJsonContent;
  };
};

/**
 * Union type of all possible node data types.
 * When adding a new node type, include it in this union.
 */
export type WorkflowNodeData =
  | InputNodeData
  | OutputNodeData
  | LLMNodeData
  | NoteNodeData
  | ToolNodeData
  | ConditionNodeData
  | HttpNodeData
  | TemplateNodeData;

/**
 * Runtime fields added during workflow execution
 */
export type NodeRuntimeField = {
  isNew?: boolean; // Flag for newly created nodes
  status?: "fail" | "running" | "success"; // Execution status
};

/**
 * UI representation of a workflow node with runtime information
 */
export type UINode<Kind extends NodeKind = NodeKind> = Node<
  Extract<WorkflowNodeData, { kind: Kind }> & { runtime?: NodeRuntimeField }
>;

/**
 * Runtime history record for node execution tracking
 * Used for debugging and monitoring workflow execution
 */
export type NodeRuntimeHistory = {
  id: string;
  nodeId: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  kind: NodeKind;
  error?: string;
  status: "fail" | "running" | "success";
  result?: {
    input?: any; // Input data passed to the node
    output?: any; // Output data produced by the node
  };
};
