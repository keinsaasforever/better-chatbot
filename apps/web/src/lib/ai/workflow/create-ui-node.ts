import { generateUUID } from "lib/utils";
import { NodeKind, UINode } from "./workflow.interface";
import { defaultObjectJsonSchema } from "./shared.workflow";
import { ObjectJsonSchema7 } from "app-types/util";

export function createUINode(
  kind: NodeKind,
  option?: Partial<{
    position: { x: number; y: number };
    name?: string;
    id?: string;
  }>,
): UINode {
  const id = option?.id ?? generateUUID();

  const node: UINode = {
    ...option,
    id,
    position: option?.position ?? { x: 0, y: 0 },
    data: {
      kind: kind as any,
      name: option?.name ?? kind.toUpperCase(),
      id,
      outputSchema: structuredClone(defaultObjectJsonSchema),
      runtime: {
        isNew: true,
      },
    },
    type: "default",
  };

  if (node.data.kind === NodeKind.Output) {
    node.data.outputData = [];
  } else if (node.data.kind === NodeKind.LLM) {
    node.data.outputSchema = structuredClone(defaultLLMNodeOutputSchema);
    node.data.messages = [
      {
        role: "user",
      },
    ];
  } else if (node.data.kind === NodeKind.Condition) {
    node.data.branches = {
      if: {
        id: "if",
        logicalOperator: "AND",
        type: "if",
        conditions: [],
      },
      else: {
        id: "else",
        logicalOperator: "AND",
        type: "else",
        conditions: [],
      },
    };
  } else if (node.data.kind === NodeKind.Tool) {
    node.data.outputSchema.properties = {
      tool_result: {
        type: "object",
      },
    };
  } else if (node.data.kind === NodeKind.Http) {
    node.data.outputSchema.properties = {
      response: {
        type: "object",
        properties: {
          status: {
            type: "number",
          },
          statusText: {
            type: "string",
          },
          ok: {
            type: "boolean",
          },
          headers: {
            type: "object",
          },
          body: {
            type: "string",
          },
          duration: {
            type: "number",
          },
          size: {
            type: "number",
          },
        },
      },
    };
    // Set default values for HTTP node
    node.data.method = "GET";
    node.data.headers = [];
    node.data.query = [];
    node.data.timeout = 30000; // 30 seconds default
  } else if (node.data.kind === NodeKind.Template) {
    node.data.outputSchema = structuredClone(defaultTemplateNodeOutputSchema);
    // Set default values for Template node
    node.data.template = {
      type: "tiptap",
      tiptap: {
        type: "doc",
        content: [],
      },
    };
  }

  return node;
}

export const defaultLLMNodeOutputSchema: ObjectJsonSchema7 = {
  type: "object",
  properties: {
    answer: {
      type: "string",
    },
    totalTokens: {
      type: "number",
    },
  },
};

export const defaultTemplateNodeOutputSchema: ObjectJsonSchema7 = {
  type: "object",
  properties: {
    template: {
      type: "string",
    },
  },
};
