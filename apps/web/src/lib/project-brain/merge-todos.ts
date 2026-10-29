/**
 * Pure merge of the consolidation model's proposed to-dos into the rows that
 * already exist for a project. No DB access, so the rules are unit-testable:
 *
 * - keys are normalised so the model's "Send-Deck" and "send_deck" collide;
 * - a proposed item matching an OPEN row updates it;
 * - a proposed item matching a DONE or DISMISSED row is ignored: the user's
 *   decision wins over every later sync;
 * - a new key is inserted;
 * - `notifyKeys` are the new items flagged `notify`, plus open rows the model
 *   now flags `notify` that were never notified before;
 * - `resolvedKeys` (items the sources show as finished) close OPEN rows only.
 */

export type TodoPriority = "low" | "normal" | "high" | "critical";
export type TodoStatus = "open" | "done" | "dismissed";

export type ExistingTodo = {
  id: string;
  key: string;
  status: TodoStatus;
  notifiedAt: string | Date | null;
};

export type ProposedTodo = {
  key: string;
  title: string;
  detail?: string | null;
  priority: TodoPriority;
  dueAt?: string | null;
  sourceScope?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  notify: boolean;
};

export type TodoMergeResult = {
  insert: ProposedTodo[];
  update: Array<{ id: string } & ProposedTodo>;
  /** ids of open rows to mark done (resolved by the sources, not a user). */
  close: string[];
  /** normalised keys that should trigger a notification in this run. */
  notifyKeys: string[];
};

export function normalizeTodoKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function mergeTodos(
  existing: ExistingTodo[],
  proposed: ProposedTodo[],
  resolvedKeys: string[] = [],
): TodoMergeResult {
  const byKey = new Map<string, ExistingTodo>();
  for (const row of existing) byKey.set(normalizeTodoKey(row.key), row);

  const result: TodoMergeResult = {
    insert: [],
    update: [],
    close: [],
    notifyKeys: [],
  };

  const seen = new Set<string>();
  for (const item of proposed) {
    const key = normalizeTodoKey(item.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const normalised: ProposedTodo = { ...item, key };
    const current = byKey.get(key);

    if (!current) {
      result.insert.push(normalised);
      if (item.notify) result.notifyKeys.push(key);
      continue;
    }

    if (current.status !== "open") continue;

    result.update.push({ id: current.id, ...normalised });
    if (item.notify && current.notifiedAt === null) {
      result.notifyKeys.push(key);
    }
  }

  for (const rawKey of resolvedKeys) {
    const key = normalizeTodoKey(rawKey);
    const current = byKey.get(key);
    // A key the model also proposed as still open stays open.
    if (!current || current.status !== "open" || seen.has(key)) continue;
    if (!result.close.includes(current.id)) result.close.push(current.id);
  }

  return result;
}
