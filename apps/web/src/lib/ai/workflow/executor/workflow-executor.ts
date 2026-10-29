import { NodeKind } from "../workflow.interface";
import {
  createGraphStore,
  type WorkflowCaller,
  WorkflowRuntimeState,
} from "./graph-store";
import { createStateGraph, graphNode, StateGraphRegistry } from "ts-edge";
import {
  conditionNodeExecutor,
  outputNodeExecutor,
  llmNodeExecutor,
  NodeExecutor,
  inputNodeExecutor,
  toolNodeExecutor,
  httpNodeExecutor,
  templateNodeExecutor,
} from "./node-executor";
import { toAny } from "lib/utils";
import { addEdgeBranchLabel } from "./add-edge-branch-label";
import { DBEdge, DBNode } from "app-types/workflow";
import { convertDBNodeToUINode } from "../shared.workflow";
import globalLogger from "logger";
import { ConsolaInstance } from "consola";
import { colorize } from "consola/utils";

/**
 * Maps node kinds to their corresponding executor functions.
 * When adding a new node type, add its executor here.
 */
function getExecutorByKind(kind: NodeKind): NodeExecutor {
  switch (kind) {
    case NodeKind.Input:
      return inputNodeExecutor;
    case NodeKind.Output:
      return outputNodeExecutor;
    case NodeKind.LLM:
      return llmNodeExecutor;
    case NodeKind.Condition:
      return conditionNodeExecutor;
    case NodeKind.Tool:
      return toolNodeExecutor;
    case NodeKind.Http:
      return httpNodeExecutor;
    case NodeKind.Template:
      return templateNodeExecutor;
    case "NOOP" as any:
      return () => {
        return {
          input: {},
          output: {},
        };
      };
  }
  return () => {
    console.warn(`Undefined '${kind}' Node Executor`);
    return {};
  };
}

/**
 * Creates a workflow executor that can run a complete workflow.
 * The executor manages:
 * - Node execution order based on dependencies
 * - Data flow between nodes
 * - Error handling and logging
 * - Branch synchronization for condition nodes
 *
 * @param workflow - Contains nodes and edges defining the workflow structure
 * @returns Compiled workflow executor ready to run
 */
export const createWorkflowExecutor = (workflow: {
  nodes: DBNode[];
  edges: DBEdge[];
  logger?: ConsolaInstance;
  /** Required for MCP tool nodes; they run with this user's access. */
  caller?: WorkflowCaller;
}) => {
  // Create runtime state store for the workflow
  const store = createGraphStore({
    nodes: workflow.nodes,
    edges: workflow.edges,
    caller: workflow.caller,
  });

  const logger =
    workflow.logger ??
    globalLogger.withDefaults({
      message: colorize("cyan", `Workflow Executor:`),
    });

  // Create mapping for node ID to name for logging
  const nodeNameByNodeId = new Map<string, string>(
    workflow.nodes.map((node) => [node.id, node.name]),
  );

  // Create the execution graph using ts-edge library
  const graph = createStateGraph(store) as StateGraphRegistry<
    WorkflowRuntimeState,
    string
  >;

  // Add branch labels for condition node edges
  addEdgeBranchLabel(workflow.nodes, workflow.edges);

  /**
   * Special SKIP node used to handle excess branches from condition nodes.
   * When multiple branches try to execute the same target node,
   * excess executions are routed here to prevent duplicate execution.
   */
  const skipNode = graphNode({
    /*  Identification  */
    name: "SKIP", // All "bypass / terminate" tokens land here
    metadata: {
      description: "Noop sink node used to silently terminate excess branches",
    },
    execute() {
      logger.debug("Noop sink node used to silently terminate excess branches");
    },
  });

  graph.addNode(skipNode);

  // Add all workflow nodes to the execution graph
  workflow.nodes.forEach((node) => {
    graph.addNode({
      name: node.id,
      metadata: {
        kind: node.kind,
      },
      async execute(state) {
        // Get the appropriate executor for this node type
        const executor = getExecutorByKind(node.kind as NodeKind);

        // Execute the node with current state
        const result = await executor({
          node: convertDBNodeToUINode(node).data,
          state,
        });

        // Store the execution results in the workflow state
        if (result?.output) {
          state.setOutput(
            {
              nodeId: node.id,
              path: [],
            },
            result.output,
          );
        }
        if (result?.input) {
          state.setInput(node.id, result.input);
        }
      },
    });

    // Handle edges differently for condition nodes vs regular nodes
    if (node.kind === NodeKind.Condition) {
      // Condition nodes use dynamic edges based on their evaluation result
      graph.dynamicEdge(node.id, (state) => {
        const next = state.getOutput({
          nodeId: node.id,
          path: ["nextNodes"],
        }) as DBNode[];
        if (!next?.length) return;
        return next.map((node) => node.id);
      });
    } else {
      // Regular nodes have static edges defined in the workflow
      const targetEdges = workflow.edges
        .filter((edge) => edge.source == node.id)
        .map((v) => v.target);

      if (targetEdges.length) toAny(graph.edge)(node.id, targetEdges);
    }
  });

  // Build table to track how many branches need to reach each node
  // Used to prevent duplicate execution when multiple condition branches
  // converge on the same target node
  let needTable: Record<string, number> = buildNeedTable(workflow.edges);

  // Compile the graph starting from the Input node
  const app = graph
    .compile(workflow.nodes.find((node) => node.kind == NodeKind.Input)!.id)
    .use(async ({ name: nodeId, input }, next) => {
      // Check if this node is expecting multiple incoming branches
      if (!(nodeId in needTable)) return;

      // Decrement the counter - only execute when all branches have arrived
      const left = --needTable[nodeId];
      if (left > 0) return next({ name: "SKIP", input });

      // All branches have arrived, clean up and continue execution
      delete needTable[nodeId];
      return next();
    });

  // Set up event logging for workflow execution monitoring
  app.subscribe((event) => {
    if (event.eventType == "WORKFLOW_START") {
      needTable = buildNeedTable(workflow.edges);
      logger.debug(
        `[${event.eventType}] ${workflow.nodes.length} nodes, ${workflow.edges.length} edges`,
      );
    } else if (event.eventType == "WORKFLOW_END") {
      const duration = ((event.endedAt - event.startedAt) / 1000).toFixed(2);
      const color = event.isOk ? "green" : "red";
      logger.debug(
        `[${event.eventType}] ${colorize(color, event.isOk ? "SUCCESS" : "FAILED")} ${duration}s`,
      );
      if (!event.isOk) {
        logger.error(event.error);
      }
    } else if (event.eventType == "NODE_START") {
      logger.debug(
        `[${event.eventType}] ${nodeNameByNodeId.get(event.node.name)}`,
      );
    } else if (event.eventType == "NODE_END") {
      const duration = ((event.endedAt - event.startedAt) / 1000).toFixed(2);
      const color = event.isOk ? "green" : "red";
      logger.debug(
        `[${event.eventType}] ${nodeNameByNodeId.get(event.node.name)} ${colorize(color, event.isOk ? "SUCCESS" : "FAILED")} ${duration}s`,
      );
    }
  });

  return app;
};

/**
 * Builds a table tracking how many different branches need to reach each target node.
 * This is used to synchronize execution when multiple condition branches
 * converge on the same target node.
 *
 * @param edges - All edges in the workflow
 * @returns Object mapping node IDs to required branch count
 */
function buildNeedTable(edges: DBEdge[]): Record<string, number> {
  const map = new Map<string, Set<string>>();

  // Group edges by target and track unique branch labels
  edges.forEach((e) => {
    const bid = e.uiConfig.label as string;
    (map.get(e.target) ?? map.set(e.target, new Set()).get(e.target))!.add(bid);
  });

  // Only nodes with multiple incoming branches need synchronization
  const tbl: Record<string, number> = {};
  map.forEach((set, n) => set.size > 1 && (tbl[n] = set.size));
  return tbl;
}
