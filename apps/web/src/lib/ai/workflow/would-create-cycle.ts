import { Connection, Edge } from "@xyflow/react";

/**
 * Check if adding a new connection would create a cycle in the graph
 * Uses DFS to detect cycles
 */
export function wouldCreateCycle(
  connection: Connection | Edge,
  existingEdges: (Connection | Edge)[],
): boolean {
  if (!connection.source || !connection.target) {
    return false;
  }

  // Create adjacency list from existing edges plus the new connection
  const adjacencyList = new Map<string, string[]>();

  // Add existing edges to adjacency list
  for (const edge of existingEdges) {
    if (!adjacencyList.has(edge.source)) {
      adjacencyList.set(edge.source, []);
    }
    adjacencyList.get(edge.source)!.push(edge.target);
  }

  // Add the proposed connection
  if (!adjacencyList.has(connection.source)) {
    adjacencyList.set(connection.source, []);
  }
  adjacencyList.get(connection.source)!.push(connection.target);

  // Perform DFS to detect cycle
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string): boolean {
    if (recursionStack.has(node)) {
      return true; // Cycle detected
    }
    if (visited.has(node)) {
      return false;
    }

    visited.add(node);
    recursionStack.add(node);

    const neighbors = adjacencyList.get(node) || [];
    for (const neighbor of neighbors) {
      if (dfs(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  // Check all nodes in the graph
  const allNodes = new Set<string>();
  for (const edge of existingEdges) {
    allNodes.add(edge.source);
    allNodes.add(edge.target);
  }
  allNodes.add(connection.source);
  allNodes.add(connection.target);

  for (const node of allNodes) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        return true;
      }
    }
  }

  return false;
}
