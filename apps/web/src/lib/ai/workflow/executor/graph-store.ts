import { objectFlow, toAny } from "lib/utils";
import { OutputSchemaSourceKey } from "../workflow.interface";
import { graphStore } from "ts-edge";
import { DBEdge, DBNode } from "app-types/workflow";
import { ObjectJsonSchema7 } from "app-types/util";
import { defaultObjectJsonSchema } from "../shared.workflow";

/** Who the workflow runs as; tool nodes act with this identity's access. */
export interface WorkflowCaller {
  userId: string;
  organizationId?: string | null;
}

export interface WorkflowRuntimeState {
  query: Record<string, unknown>;
  caller?: WorkflowCaller;
  inputs: {
    [nodeId: string]: any;
  };
  nodes: DBNode[];
  edges: DBEdge[];
  outputs: {
    [nodeId: string]: any;
  };
  setInput(nodeId: string, value: any): void;
  getInput(nodeId: string): any;
  setOutput(key: OutputSchemaSourceKey, value: any): void;
  getOutput<T>(key: OutputSchemaSourceKey): undefined | T;
}

export const createGraphStore = (params: {
  nodes: DBNode[];
  edges: DBEdge[];
  caller?: WorkflowCaller;
}) => {
  return graphStore<WorkflowRuntimeState>((set, get) => {
    return {
      query: {},
      caller: params.caller,
      outputs: {},
      inputs: {},
      nodes: params.nodes,
      edges: params.edges,
      setInput(nodeId, value) {
        set((prev) => {
          return { inputs: { ...prev.inputs, [nodeId]: value } };
        });
      },
      getInput(nodeId) {
        const { inputs } = get();
        return inputs[nodeId];
      },
      setOutput(key, value) {
        set((prev) => {
          const next = objectFlow(prev.outputs).setByPath(
            [key.nodeId, ...key.path],
            value,
          );
          return {
            outputs: next,
          };
        });
      },
      getOutput(key) {
        const { outputs, nodes } = get();
        const targetNode = nodes.find((n) => n.id == key.nodeId);
        const schema =
          (targetNode?.nodeConfig?.outputSchema as ObjectJsonSchema7) ??
          defaultObjectJsonSchema;
        const defaultValue = key.path.length
          ? key.path.reduce(
              (acc, cur, index) => {
                const isLast = index === key.path.length - 1;
                if (isLast) return acc?.[cur]?.default;
                return acc?.[cur]?.properties?.[cur];
              },
              (schema.properties ?? {}) as any,
            )
          : toAny(schema)?.default;

        return (
          objectFlow(outputs[key.nodeId]).getByPath(key.path) ?? defaultValue
        );
      },
    };
  });
};
