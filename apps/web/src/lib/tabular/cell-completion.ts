/**
 * Which tabular review cells still need a model call.
 *
 * A row exists for every document x column from the moment the review is
 * created (`lib/ai/tools/tabular/create-tabular-tool.ts`), so "has this been
 * answered?" is a property of the stored row, not of its absence. Both sides
 * of the generation flow have to agree on that predicate: the card remounts
 * whenever a thread is reopened, and it used to start generation
 * unconditionally - re-running, and re-billing, every cell that already held
 * an answer.
 */

export type StoredCell = {
  documentId: string;
  columnId: string;
  value: string | null;
  status?: string | null;
};

export const cellKey = (documentId: string, columnId: string) =>
  `${documentId}:${columnId}`;

/**
 * "done" with text in it. Anything else - `pending`, a `generating` cell left
 * behind by an interrupted run, an `error` - is worth another attempt.
 */
export const isAnsweredCell = (cell: StoredCell): boolean =>
  cell.status === "done" && Boolean(cell.value?.trim());

/** Answered cells keyed by document and column, for skipping during a run. */
export const collectAnsweredCells = (
  cells: StoredCell[],
): Map<string, string> => {
  const answered = new Map<string, string>();
  for (const cell of cells) {
    if (isAnsweredCell(cell)) {
      answered.set(cellKey(cell.documentId, cell.columnId), cell.value ?? "");
    }
  }
  return answered;
};

/**
 * Is there anything left to generate? An empty list counts as unanswered so a
 * review whose rows could not be read still generates rather than silently
 * reporting itself complete.
 */
export const hasUnansweredCells = (cells: StoredCell[]): boolean =>
  cells.length === 0 || cells.some((cell) => !isAnsweredCell(cell));
