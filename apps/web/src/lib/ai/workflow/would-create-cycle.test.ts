import { describe, it, expect } from "vitest";
import { wouldCreateCycle } from "./would-create-cycle";
import { Connection, Edge } from "@xyflow/react";

describe("wouldCreateCycle", () => {
  // Helper function to create a connection
  const createConnection = (source: string, target: string): Connection => ({
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
  });

  // Helper function to create an edge
  const createEdge = (id: string, source: string, target: string): Edge => ({
    id,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
  });

  it("should return false for empty graph", () => {
    const connection = createConnection("A", "B");
    const existingEdges: Edge[] = [];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(false);
  });

  it("should return false for simple linear connection", () => {
    const connection = createConnection("B", "C");
    const existingEdges = [createEdge("1", "A", "B")];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(false);
  });

  it("should return true for direct cycle (A -> B -> A)", () => {
    const connection = createConnection("B", "A");
    const existingEdges = [createEdge("1", "A", "B")];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(true);
  });

  it("should return true for indirect cycle (A -> B -> C -> A)", () => {
    const connection = createConnection("C", "A");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "B", "C"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(true);
  });

  it("should return true for complex cycle", () => {
    const connection = createConnection("D", "B");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "B", "C"),
      createEdge("3", "C", "D"),
      createEdge("4", "A", "E"),
      createEdge("5", "E", "F"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(true);
  });

  it("should return false for branching without cycles", () => {
    const connection = createConnection("D", "E");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "A", "C"),
      createEdge("3", "B", "D"),
      createEdge("4", "C", "D"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(false);
  });

  it("should return false for disconnected components", () => {
    const connection = createConnection("D", "E");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "B", "C"),
      createEdge("3", "X", "Y"),
      createEdge("4", "Y", "Z"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(false);
  });

  it("should handle self-loop correctly", () => {
    const connection = createConnection("A", "A");
    const existingEdges: Edge[] = [];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(true);
  });

  it("should return false when connection source or target is missing", () => {
    const connectionWithoutSource = {
      source: null,
      target: "B",
      sourceHandle: null,
      targetHandle: null,
    } as unknown as Connection;

    const connectionWithoutTarget = {
      source: "A",
      target: null,
      sourceHandle: null,
      targetHandle: null,
    } as unknown as Connection;

    const existingEdges = [createEdge("1", "A", "B")];

    expect(wouldCreateCycle(connectionWithoutSource, existingEdges)).toBe(
      false,
    );
    expect(wouldCreateCycle(connectionWithoutTarget, existingEdges)).toBe(
      false,
    );
  });

  it("should detect cycle in diamond shape graph", () => {
    const connection = createConnection("D", "A");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "A", "C"),
      createEdge("3", "B", "D"),
      createEdge("4", "C", "D"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(true);
  });

  it("should handle large graph with multiple paths without cycle", () => {
    const connection = createConnection("F", "G");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "A", "C"),
      createEdge("3", "B", "D"),
      createEdge("4", "C", "D"),
      createEdge("5", "D", "E"),
      createEdge("6", "E", "F"),
      createEdge("7", "B", "H"),
      createEdge("8", "H", "I"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(false);
  });

  it("should handle connection between existing isolated nodes", () => {
    const connection = createConnection("X", "Y");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "B", "C"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(false);
  });

  it("should detect long cycle path", () => {
    const connection = createConnection("E", "A");
    const existingEdges = [
      createEdge("1", "A", "B"),
      createEdge("2", "B", "C"),
      createEdge("3", "C", "D"),
      createEdge("4", "D", "E"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(true);
  });

  it("should return false for single node graph", () => {
    const connection = createConnection("A", "B");
    const existingEdges: Edge[] = [];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(false);
  });

  it("should handle multiple incoming edges to same node", () => {
    const connection = createConnection("D", "A");
    const existingEdges = [
      createEdge("1", "A", "D"),
      createEdge("2", "B", "D"),
      createEdge("3", "C", "D"),
    ];

    const result = wouldCreateCycle(connection, existingEdges);

    expect(result).toBe(true);
  });
});
