import { DBEdge, DBNode } from "app-types/workflow";
import { NodeKind } from "../workflow.interface";

export function addEdgeBranchLabel(nodes: DBNode[], edges: DBEdge[]) {
  const outs = (id: string) => edges.filter((e) => e.source === id);
  const start = nodes.find((n) => n.kind === NodeKind.Input)!;
  const q: { id: string; bid: string }[] = [{ id: start.id, bid: "B0" }];

  while (q.length) {
    const { id, bid } = q.shift()!;
    const node = nodes.find((n) => n.id === id)!;
    const nexts = outs(id);

    if (node.kind === NodeKind.Condition) {
      const byHandle = new Map<string, DBEdge[]>();
      nexts.forEach((e) => {
        const h = e.uiConfig.sourceHandle ?? "right";
        (byHandle.get(h) ?? byHandle.set(h, []).get(h))!.push(e);
      });
      byHandle.forEach((group) => {
        if (group.length === 1) {
          const [e] = group;
          if (!e.uiConfig.label) {
            e.uiConfig.label = bid;
            q.push({ id: e.target, bid });
          }
        } else {
          group.forEach((e, i) => {
            const newBid = `${bid}.${i}`;
            if (!e.uiConfig.label) {
              e.uiConfig.label = newBid;
              q.push({ id: e.target, bid: newBid });
            }
          });
        }
      });
    } else {
      nexts.forEach((e, i) => {
        const newBid = nexts.length > 1 ? `${bid}.${i}` : bid;
        if (!e.uiConfig.label) {
          e.uiConfig.label = newBid;
          q.push({ id: e.target, bid: newBid });
        }
      });
    }
  }
}
