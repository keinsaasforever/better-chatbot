import { describe, it, expect } from "vitest";
import { Edge } from "@xyflow/react";
import { extractWorkflowDiff } from "./extract-workflow-diff";
import { UINode, NodeKind } from "./workflow.interface";

describe("extractWorkflowDiff", () => {
  const createTestNode = (
    id: string,
    name: string,
    position = { x: 0, y: 0 },
  ): UINode => ({
    id,
    type: "default",
    position,
    data: {
      id,
      name,
      kind: NodeKind.Input,
      outputSchema: { type: "object", properties: {} },
      runtime: {},
    },
  });

  const createTestEdge = (
    id: string,
    source: string,
    target: string,
  ): Edge => ({
    id,
    source,
    target,
  });

  it("should detect added nodes and edges", () => {
    const oldData = {
      nodes: [createTestNode("node1", "Node 1")],
      edges: [createTestEdge("edge1", "node1", "node2")],
    };

    const newData = {
      nodes: [
        createTestNode("node1", "Node 1"),
        createTestNode("node2", "Node 2", { x: 100, y: 100 }),
      ],
      edges: [
        createTestEdge("edge1", "node1", "node2"),
        createTestEdge("edge2", "node2", "node3"),
      ],
    };

    const result = extractWorkflowDiff(oldData, newData);

    expect(result.deleteNodes).toHaveLength(0);
    expect(result.deleteEdges).toHaveLength(0);
    expect(result.updateNodes).toHaveLength(1);
    expect(result.updateEdges).toHaveLength(1);
    expect(result.updateNodes[0].id).toBe("node2");
    expect(result.updateEdges[0].id).toBe("edge2");
  });

  it("should detect deleted and updated nodes and edges", () => {
    const oldData = {
      nodes: [
        createTestNode("node1", "Node 1"),
        createTestNode("node2", "Node 2"),
        createTestNode("node3", "Node 3", { x: 50, y: 50 }),
      ],
      edges: [
        createTestEdge("edge1", "node1", "node2"),
        createTestEdge("edge2", "node2", "node3"),
      ],
    };

    const newData = {
      nodes: [
        createTestNode("node1", "Node 1 Updated", { x: 10, y: 10 }),
        createTestNode("node3", "Node 3", { x: 50, y: 50 }),
      ],
      edges: [createTestEdge("edge1", "node1", "node3")],
    };

    const result = extractWorkflowDiff(oldData, newData);

    expect(result.deleteNodes).toHaveLength(1);
    expect(result.deleteNodes[0].id).toBe("node2");
    expect(result.deleteEdges).toHaveLength(1);
    expect(result.deleteEdges[0].id).toBe("edge2");
    expect(result.updateNodes).toHaveLength(1);
    expect(result.updateNodes[0].id).toBe("node1");
    expect(result.updateEdges).toHaveLength(1);
    expect(result.updateEdges[0].id).toBe("edge1");
  });
});
