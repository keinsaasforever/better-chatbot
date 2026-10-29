import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

/**
 * Client-side force layout for the Graph tab. Runs the simulation to
 * convergence synchronously (a few hundred ticks for <= 150 nodes is well
 * under a frame budget) so React Flow receives final positions and the user
 * can still drag nodes afterwards.
 */

export type LayoutNode = {
  id: string;
  /** Hub node sits at the centre and is pinned. */
  isHub?: boolean;
  /** 0..n; larger nodes push neighbours further away. */
  size: number;
};

export type LayoutEdge = {
  source: string;
  target: string;
  /** Virtual hub edges are weaker so real relations dominate the shape. */
  virtual?: boolean;
};

export type LayoutPosition = { x: number; y: number };

const TICKS = 300;

export function computeForceLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: { width?: number; height?: number } = {},
): Map<string, LayoutPosition> {
  const width = options.width ?? 1200;
  const height = options.height ?? 720;
  if (!nodes.length) return new Map();

  type SimNode = LayoutNode & {
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
  };

  const simNodes: SimNode[] = nodes.map((node, index) => {
    const angle = (2 * Math.PI * index) / nodes.length;
    return {
      ...node,
      x: node.isHub ? 0 : Math.cos(angle) * 300,
      y: node.isHub ? 0 : Math.sin(angle) * 300,
      fx: node.isHub ? 0 : null,
      fy: node.isHub ? 0 : null,
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const simEdges = edges
    .filter((edge) => ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ ...edge }));

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, (typeof simEdges)[number]>(simEdges)
        .id((node) => node.id)
        .distance((edge) => (edge.virtual ? 260 : 140))
        .strength((edge) => (edge.virtual ? 0.15 : 0.6)),
    )
    .force("charge", forceManyBody<SimNode>().strength(-420))
    .force(
      "collide",
      forceCollide<SimNode>().radius((node) => 40 + node.size * 6),
    )
    .force("center", forceCenter(0, 0))
    .force("x", forceX(0).strength(0.03))
    .force("y", forceY(0).strength(0.03))
    .stop();

  for (let i = 0; i < TICKS; i++) simulation.tick();

  const positions = new Map<string, LayoutPosition>();
  for (const node of simNodes) {
    positions.set(node.id, {
      x: Math.round((node.x ?? 0) + width / 2),
      y: Math.round((node.y ?? 0) + height / 2),
    });
  }
  return positions;
}
