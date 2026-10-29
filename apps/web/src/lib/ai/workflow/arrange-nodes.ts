import { Edge } from "@xyflow/react";
import { UINode, NodeKind } from "./workflow.interface";

const LEVEL_GAP = 360; // Gap between levels on X axis
const NODE_PADDING = 120; // Padding between nodes to prevent overlap
const DEFAULT_NODE_HEIGHT = 120; // Default node height if measured is not available

export interface ArrangeNodesResult {
  nodes: UINode[];
}

interface PlacedNode {
  id: string;
  y: number;
  height: number;
  topBound: number;
  bottomBound: number;
}

interface NodeToPlace {
  nodeId: string;
  parentIds: string[];
  originalY: number; // Keep track of original Y position
  height: number;
}

/**
 * Arrange workflow nodes in a hierarchical layout
 * Starting from Input node as root, arranges nodes in a DAG structure
 * Considers existing positions and actual node heights to prevent overlaps
 */
export function arrangeNodes(
  nodes: UINode[],
  edges: Edge[],
): ArrangeNodesResult {
  // Create a copy of nodes
  const arrangedNodes = nodes.map((node) => ({ ...node }));

  // Filter out nodes without edges
  const connectedNodeIds = new Set([
    ...edges.map((edge) => edge.source),
    ...edges.map((edge) => edge.target),
  ]);

  const nodesWithEdges = arrangedNodes.filter((node) =>
    connectedNodeIds.has(node.id),
  );

  // Find Input node
  const inputNode = nodesWithEdges.find(
    (node) => node.data.kind === NodeKind.Input,
  );

  if (!inputNode) {
    return { nodes: arrangedNodes };
  }

  // Build adjacency maps
  const childrenMap = new Map<string, string[]>();
  const parentsMap = new Map<string, string[]>();

  // Sort edges for condition nodes by sourceHandle priority
  const sortedEdges = [...edges].sort((a, b) => {
    if (a.source === b.source) {
      return (
        getSourceHandlePriority(a.sourceHandle) -
        getSourceHandlePriority(b.sourceHandle)
      );
    }
    return 0;
  });

  sortedEdges.forEach((edge) => {
    if (!childrenMap.has(edge.source)) {
      childrenMap.set(edge.source, []);
    }
    if (!parentsMap.has(edge.target)) {
      parentsMap.set(edge.target, []);
    }

    childrenMap.get(edge.source)!.push(edge.target);
    parentsMap.get(edge.target)!.push(edge.source);
  });

  // Calculate levels using BFS
  const levels = new Map<string, number>();
  const queue = [{ nodeId: inputNode.id, level: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const { nodeId, level } = queue.shift()!;

    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    levels.set(nodeId, level);

    const children = childrenMap.get(nodeId) || [];
    children.forEach((childId) => {
      if (!visited.has(childId)) {
        queue.push({ nodeId: childId, level: level + 1 });
      }
    });
  }

  // Calculate node positions
  const nodePositions = new Map<string, { x: number; y: number }>();
  const maxLevel = Math.max(...levels.values());

  // Place input node at origin
  nodePositions.set(inputNode.id, { x: 0, y: 0 });

  // Process each level
  for (let level = 0; level <= maxLevel; level++) {
    if (level === 0) continue; // Input node already placed

    const levelNodes = Array.from(levels.entries())
      .filter(([_, nodeLevel]) => nodeLevel === level)
      .map(([nodeId, _]) => nodeId);

    // Group nodes by their parents
    const parentGroups = new Map<string, NodeToPlace[]>();

    levelNodes.forEach((nodeId) => {
      const parents = parentsMap.get(nodeId) || [];
      const parentKey = parents.sort().join(",");
      const nodeHeight = getNodeHeight(
        arrangedNodes.find((n) => n.id === nodeId),
      );
      const originalY =
        arrangedNodes.find((n) => n.id === nodeId)?.position.y || 0;

      if (!parentGroups.has(parentKey)) {
        parentGroups.set(parentKey, []);
      }

      parentGroups.get(parentKey)!.push({
        nodeId,
        parentIds: parents,
        originalY,
        height: nodeHeight,
      });
    });

    // Sort each parent group by original Y position to maintain relative order within siblings
    parentGroups.forEach((groupNodes) => {
      groupNodes.sort((a, b) => a.originalY - b.originalY);
    });

    // Sort parent groups by their parents' Y positions
    const sortedParentGroups = Array.from(parentGroups.entries()).sort(
      ([keyA], [keyB]) => {
        const parentsA = keyA ? keyA.split(",") : [];
        const parentsB = keyB ? keyB.split(",") : [];

        // Get average parent Y position for each group
        const getGroupParentAvgY = (parents: string[]) => {
          if (parents.length === 0) return 0;

          const parentYs = parents
            .map((parentId) => nodePositions.get(parentId)?.y)
            .filter((y) => y !== undefined) as number[];

          return parentYs.length > 0
            ? parentYs.reduce((sum, y) => sum + y, 0) / parentYs.length
            : 0;
        };

        const avgYA = getGroupParentAvgY(parentsA);
        const avgYB = getGroupParentAvgY(parentsB);

        return avgYA - avgYB;
      },
    );

    // Track placed nodes in this level to avoid overlaps
    const placedNodesInLevel: PlacedNode[] = [];
    const x = level * LEVEL_GAP;

    // Place nodes from each parent group in order
    for (const [parentKey, groupNodes] of sortedParentGroups) {
      const parents = parentKey ? parentKey.split(",") : [];

      if (parents.length === 1) {
        // Single parent case
        const parentPos = nodePositions.get(parents[0]);
        if (!parentPos) continue;

        if (groupNodes.length === 1) {
          // Single child - try to keep same Y as parent, but avoid overlaps
          const nodeToPlace = groupNodes[0];
          let targetY = parentPos.y;

          // Check for overlaps and adjust if necessary
          targetY = findNonOverlappingY(
            targetY,
            nodeToPlace.height,
            placedNodesInLevel,
          );

          nodePositions.set(nodeToPlace.nodeId, { x, y: targetY });
          placedNodesInLevel.push({
            id: nodeToPlace.nodeId,
            y: targetY,
            height: nodeToPlace.height,
            topBound: targetY - nodeToPlace.height / 2 - NODE_PADDING / 2,
            bottomBound: targetY + nodeToPlace.height / 2 + NODE_PADDING / 2,
          });
        } else {
          // Multiple children - distribute around parent, maintaining original relative order
          const totalRequiredHeight = groupNodes.reduce((sum, nodeToPlace) => {
            return sum + nodeToPlace.height + NODE_PADDING;
          }, -NODE_PADDING); // Remove last padding

          let startY = parentPos.y - totalRequiredHeight / 2;

          // Adjust start position to avoid overlaps with existing nodes
          const firstNodeHeight = groupNodes[0].height;
          const adjustedStartY = findNonOverlappingY(
            startY + firstNodeHeight / 2,
            firstNodeHeight,
            placedNodesInLevel,
          );
          const adjustment = adjustedStartY - (startY + firstNodeHeight / 2);
          startY += adjustment;

          let currentY = startY;
          groupNodes.forEach((nodeToPlace) => {
            const nodeY = currentY + nodeToPlace.height / 2;

            nodePositions.set(nodeToPlace.nodeId, { x, y: nodeY });
            placedNodesInLevel.push({
              id: nodeToPlace.nodeId,
              y: nodeY,
              height: nodeToPlace.height,
              topBound: nodeY - nodeToPlace.height / 2 - NODE_PADDING / 2,
              bottomBound: nodeY + nodeToPlace.height / 2 + NODE_PADDING / 2,
            });

            currentY += nodeToPlace.height + NODE_PADDING;
          });
        }
      } else if (parents.length > 1) {
        // Merge node case - use the topmost parent's Y position, but avoid overlaps
        const parentPositions = parents
          .map((parentId) => nodePositions.get(parentId))
          .filter((pos) => pos !== undefined)
          .sort((a, b) => a!.y - b!.y);

        if (parentPositions.length > 0) {
          const baseY = parentPositions[0]!.y;

          groupNodes.forEach((nodeToPlace) => {
            if (!nodePositions.has(nodeToPlace.nodeId)) {
              const targetY = findNonOverlappingY(
                baseY,
                nodeToPlace.height,
                placedNodesInLevel,
              );

              nodePositions.set(nodeToPlace.nodeId, { x, y: targetY });
              placedNodesInLevel.push({
                id: nodeToPlace.nodeId,
                y: targetY,
                height: nodeToPlace.height,
                topBound: targetY - nodeToPlace.height / 2 - NODE_PADDING / 2,
                bottomBound:
                  targetY + nodeToPlace.height / 2 + NODE_PADDING / 2,
              });
            }
          });
        }
      }
    }
  }

  // Apply positions to nodes
  arrangedNodes.forEach((node) => {
    const newPosition = nodePositions.get(node.id);
    if (newPosition) {
      node.position = newPosition;
    }
  });

  return { nodes: arrangedNodes };
}

/**
 * Get priority for sourceHandle sorting
 * Lower numbers have higher priority
 */
function getSourceHandlePriority(
  sourceHandle: string | undefined | null,
): number {
  if (!sourceHandle) return 0;

  switch (sourceHandle) {
    case "if":
      return 1;
    case "elseif":
      return 2;
    case "else":
      return 3;
    default:
      return 0;
  }
}

/**
 * Get the height of a node, considering measured height if available
 */
function getNodeHeight(node: UINode | undefined): number {
  if (!node) return DEFAULT_NODE_HEIGHT;

  // Check if node has measured height
  const measured = (node as any).measured;
  if (measured && measured.height) {
    return measured.height;
  }

  return DEFAULT_NODE_HEIGHT;
}

/**
 * Find a Y position that doesn't overlap with existing placed nodes
 */
function findNonOverlappingY(
  preferredY: number,
  nodeHeight: number,
  placedNodes: PlacedNode[],
): number {
  const halfHeight = nodeHeight / 2;
  const paddingHalf = NODE_PADDING / 2;

  let candidateY = preferredY;
  let attempts = 0;
  const maxAttempts = 100; // Prevent infinite loops

  while (attempts < maxAttempts) {
    const topBound = candidateY - halfHeight - paddingHalf;
    const bottomBound = candidateY + halfHeight + paddingHalf;

    // Check if this position overlaps with any placed node
    const hasOverlap = placedNodes.some(
      (placed) =>
        !(bottomBound <= placed.topBound || topBound >= placed.bottomBound),
    );

    if (!hasOverlap) {
      return candidateY;
    }

    // Find the closest conflicting node and position after it
    const conflictingNodes = placedNodes.filter(
      (placed) =>
        !(bottomBound <= placed.topBound || topBound >= placed.bottomBound),
    );

    if (conflictingNodes.length > 0) {
      const lowestConflictBottom = Math.max(
        ...conflictingNodes.map((n) => n.bottomBound),
      );
      candidateY = lowestConflictBottom + halfHeight + paddingHalf;
    } else {
      candidateY += nodeHeight + NODE_PADDING;
    }

    attempts++;
  }

  return candidateY;
}
