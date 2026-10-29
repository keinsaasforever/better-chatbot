import { describe, it, expect } from "vitest";
import { addEdgeBranchLabel } from "./add-edge-branch-label";
import { NodeKind } from "../workflow.interface";
import { DBEdge, DBNode } from "app-types/workflow";
import { convertUINodeToDBNode } from "../shared.workflow";
import { createUINode } from "../create-ui-node";

describe("addEdgeBranchLabel", () => {
  // Helper function to create a node
  const createNode = (
    id: string,
    kind: NodeKind,
    name: string = `Node ${id}`,
  ): DBNode => {
    const uiNode = createUINode(kind, {
      name,
      id,
    });
    return convertUINodeToDBNode("workflowId", uiNode) as DBNode;
  };

  // Helper function to create an edge
  const createEdge = (
    id: string,
    source: string,
    target: string,
    sourceHandle?: string,
    label?: string,
  ): DBEdge => ({
    id,
    source,
    target,
    uiConfig: {
      sourceHandle,
      label,
    },
    workflowId: "workflowId",
    createdAt: new Date(),
  });

  it("should add B0 label to single linear path", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("end", NodeKind.Output, "End"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "llm1"),
      createEdge("e2", "llm1", "end"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0");
    expect(edges[1].uiConfig.label).toBe("B0");
  });

  it("should add parallel branch labels for multiple outputs from start", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("end", NodeKind.Output, "End"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "llm1"),
      createEdge("e2", "start", "llm2"),
      createEdge("e3", "llm1", "end"),
      createEdge("e4", "llm2", "end"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0.0");
    expect(edges[1].uiConfig.label).toBe("B0.1");
    expect(edges[2].uiConfig.label).toBe("B0.0");
    expect(edges[3].uiConfig.label).toBe("B0.1");
  });

  it("should handle condition node with single edge per handle", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("cond", NodeKind.Condition, "Condition"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("end", NodeKind.Output, "End"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "cond"),
      createEdge("e2", "cond", "llm1", "true"),
      createEdge("e3", "cond", "llm2", "false"),
      createEdge("e4", "llm1", "end"),
      createEdge("e5", "llm2", "end"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0");
    expect(edges[1].uiConfig.label).toBe("B0"); // single edge from true handle
    expect(edges[2].uiConfig.label).toBe("B0"); // single edge from false handle
    expect(edges[3].uiConfig.label).toBe("B0");
    expect(edges[4].uiConfig.label).toBe("B0");
  });

  it("should handle condition node with multiple edges per handle", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("cond", NodeKind.Condition, "Condition"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("llm3", NodeKind.LLM, "LLM3"),
      createNode("llm4", NodeKind.LLM, "LLM4"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "cond"),
      createEdge("e2", "cond", "llm1", "true"),
      createEdge("e3", "cond", "llm2", "true"),
      createEdge("e4", "cond", "llm3", "false"),
      createEdge("e5", "cond", "llm4", "false"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0");
    expect(edges[1].uiConfig.label).toBe("B0.0"); // first edge from true handle
    expect(edges[2].uiConfig.label).toBe("B0.1"); // second edge from true handle
    expect(edges[3].uiConfig.label).toBe("B0.0"); // first edge from false handle
    expect(edges[4].uiConfig.label).toBe("B0.1"); // second edge from false handle
  });

  it("should handle condition node with default handle", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("cond", NodeKind.Condition, "Condition"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "cond"),
      createEdge("e2", "cond", "llm1"), // no sourceHandle (default)
      createEdge("e3", "cond", "llm2"), // no sourceHandle (default)
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0");
    expect(edges[1].uiConfig.label).toBe("B0.0");
    expect(edges[2].uiConfig.label).toBe("B0.1");
  });

  it("should handle complex workflow with mixed node types", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("cond", NodeKind.Condition, "Condition"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("llm3", NodeKind.LLM, "LLM3"),
      createNode("llm4", NodeKind.LLM, "LLM4"),
      createNode("end", NodeKind.Output, "End"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "llm1"),
      createEdge("e2", "llm1", "cond"),
      createEdge("e3", "cond", "llm2", "true"),
      createEdge("e4", "cond", "llm3", "false"),
      createEdge("e5", "llm2", "llm4"),
      createEdge("e6", "llm3", "llm4"),
      createEdge("e7", "llm4", "end"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0"); // start -> llm1
    expect(edges[1].uiConfig.label).toBe("B0"); // llm1 -> cond
    expect(edges[2].uiConfig.label).toBe("B0"); // cond -> llm2 (true)
    expect(edges[3].uiConfig.label).toBe("B0"); // cond -> llm3 (false)
    expect(edges[4].uiConfig.label).toBe("B0"); // llm2 -> llm4
    expect(edges[5].uiConfig.label).toBe("B0"); // llm3 -> llm4
    expect(edges[6].uiConfig.label).toBe("B0"); // llm4 -> end
  });

  it("should handle nested parallel branches", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("llm3", NodeKind.LLM, "LLM3"),
      createNode("llm4", NodeKind.LLM, "LLM4"),
      createNode("end", NodeKind.Output, "End"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "llm1"),
      createEdge("e2", "start", "llm2"),
      createEdge("e3", "llm1", "llm3"),
      createEdge("e4", "llm1", "llm4"),
      createEdge("e5", "llm2", "end"),
      createEdge("e6", "llm3", "end"),
      createEdge("e7", "llm4", "end"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0.0"); // start -> llm1
    expect(edges[1].uiConfig.label).toBe("B0.1"); // start -> llm2
    expect(edges[2].uiConfig.label).toBe("B0.0.0"); // llm1 -> llm3
    expect(edges[3].uiConfig.label).toBe("B0.0.1"); // llm1 -> llm4
    expect(edges[4].uiConfig.label).toBe("B0.1"); // llm2 -> end
    expect(edges[5].uiConfig.label).toBe("B0.0.0"); // llm3 -> end
    expect(edges[6].uiConfig.label).toBe("B0.0.1"); // llm4 -> end
  });

  it("should not overwrite existing labels and handle remaining path correctly", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("end", NodeKind.Output, "End"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "llm1", undefined, "CustomLabel"),
      createEdge("e2", "llm1", "llm2"),
      createEdge("e3", "llm2", "end"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("CustomLabel"); // should not be overwritten
    // Since the first edge has a custom label, the traversal stops there
    // and doesn't continue to label the rest of the path
    expect(edges[1].uiConfig.label).toBeUndefined();
    expect(edges[2].uiConfig.label).toBeUndefined();
  });

  it("should handle single node workflow", () => {
    const nodes: DBNode[] = [createNode("start", NodeKind.Input, "Start")];
    const edges: DBEdge[] = [];

    addEdgeBranchLabel(nodes, edges);

    // Should not throw error with empty edges array
    expect(edges).toHaveLength(0);
  });

  it("should handle disconnected subgraphs", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("isolated", NodeKind.LLM, "Isolated"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "llm1"),
      // isolated node has no connections
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0");
  });

  it("should handle condition node with mixed handle types", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("cond", NodeKind.Condition, "Condition"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("llm3", NodeKind.LLM, "LLM3"),
      createNode("llm4", NodeKind.LLM, "LLM4"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "cond"),
      createEdge("e2", "cond", "llm1", "true"),
      createEdge("e3", "cond", "llm2", "true"),
      createEdge("e4", "cond", "llm3", "false"),
      createEdge("e5", "cond", "llm4"), // default handle
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0");
    expect(edges[1].uiConfig.label).toBe("B0.0"); // true handle, first edge
    expect(edges[2].uiConfig.label).toBe("B0.1"); // true handle, second edge
    expect(edges[3].uiConfig.label).toBe("B0"); // false handle, single edge
    expect(edges[4].uiConfig.label).toBe("B0"); // default handle, single edge
  });

  it("should handle workflow with existing labels in the middle of path", () => {
    const nodes: DBNode[] = [
      createNode("start", NodeKind.Input, "Start"),
      createNode("llm1", NodeKind.LLM, "LLM1"),
      createNode("llm2", NodeKind.LLM, "LLM2"),
      createNode("llm3", NodeKind.LLM, "LLM3"),
    ];

    const edges: DBEdge[] = [
      createEdge("e1", "start", "llm1"),
      createEdge("e2", "llm1", "llm2", undefined, "ExistingLabel"),
      createEdge("e3", "llm2", "llm3"),
    ];

    addEdgeBranchLabel(nodes, edges);

    expect(edges[0].uiConfig.label).toBe("B0");
    expect(edges[1].uiConfig.label).toBe("ExistingLabel"); // existing label preserved
    // The traversal should continue from llm2 since it was reached
    expect(edges[2].uiConfig.label).toBeUndefined(); // but this won't be labeled since traversal stops at existing label
  });
});
