/**
 * Reciprocal rank fusion (Cormack et al.): merge several ranked lists into one
 * without calibrating their scores against each other. An item ranked r in a
 * list contributes 1 / (k + r); items present in several lists add up.
 */
export type RankedItem = { id: string };

export function rrfFuse<T extends RankedItem>(
  lists: T[][],
  options: { k?: number; weights?: number[] } = {},
): Array<{ item: T; score: number; hits: number }> {
  const k = options.k ?? 60;
  const scores = new Map<string, { item: T; score: number; hits: number }>();

  lists.forEach((list, listIndex) => {
    const weight = options.weights?.[listIndex] ?? 1;
    list.forEach((item, rank) => {
      const entry = scores.get(item.id) ?? { item, score: 0, hits: 0 };
      entry.score += weight / (k + rank + 1);
      entry.hits += 1;
      scores.set(item.id, entry);
    });
  });

  return [...scores.values()].sort((a, b) => b.score - a.score);
}
