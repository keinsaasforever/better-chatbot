/**
 * Turns whatever a project-brain run threw into something safe to store on
 * the run row and to show a member: a short error code plus a short cause.
 *
 * Drizzle wraps database failures in a `DrizzleQueryError` whose `message` is
 * the full SQL text plus every parameter. That is what used to land in
 * `project_brain_run.error_message` and on the project page. The Postgres
 * error (`error.cause`) carries the useful sentence and a SQLSTATE; that is
 * what we keep. The full error still goes to the server log.
 */

export type RunErrorDescription = {
  code: string;
  message: string;
};

const MAX_MESSAGE = 300;

const SQLSTATE_CODES: Record<string, string> = {
  "23514": "schema_constraint",
  "23505": "duplicate_row",
  "23503": "missing_reference",
  "57014": "db_timeout",
  "40P01": "db_deadlock",
};

type ErrorLike = {
  message?: unknown;
  code?: unknown;
  name?: unknown;
  cause?: unknown;
};

function asErrorLike(value: unknown): ErrorLike | null {
  return typeof value === "object" && value !== null
    ? (value as ErrorLike)
    : null;
}

function isDrizzleWrapper(error: ErrorLike) {
  return (
    error.name === "DrizzleQueryError" ||
    (typeof error.message === "string" &&
      error.message.startsWith("Failed query"))
  );
}

/** The innermost error worth reporting: the database error under Drizzle's wrapper. */
export function rootCause(error: unknown): ErrorLike | null {
  let current = asErrorLike(error);
  let depth = 0;
  while (current && isDrizzleWrapper(current) && depth < 5) {
    const next = asErrorLike(current.cause);
    if (!next) break;
    current = next;
    depth++;
  }
  return current;
}

function cleanMessage(message: string) {
  return (
    message
      // Anything Drizzle appended after the SQL is not for humans.
      .replace(/\s*params:[\s\S]*$/i, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_MESSAGE) || "Unknown error"
  );
}

/**
 * `fallbackCode` is used when the error carries no recognisable code of its
 * own (a `ProjectSourceError.code`, a budget/abort code, a SQLSTATE).
 */
export function describeRunError(
  error: unknown,
  fallbackCode = "pipeline_failed",
): RunErrorDescription {
  const outer = asErrorLike(error);
  const cause = rootCause(error);

  // Codes set by our own error classes win (ProjectSourceError, budget, …).
  const ownCode =
    typeof outer?.code === "string" && !/^[0-9A-Z]{5}$/.test(outer.code)
      ? outer.code
      : null;

  const sqlState =
    typeof cause?.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code)
      ? cause.code
      : null;

  const message =
    typeof cause?.message === "string" && cause.message
      ? cause.message
      : typeof outer?.message === "string" && outer.message
        ? outer.message
        : String(error ?? "");

  return {
    code:
      ownCode ??
      (sqlState ? (SQLSTATE_CODES[sqlState] ?? "db_error") : fallbackCode),
    message: cleanMessage(
      // A Drizzle wrapper without a cause would otherwise leak the SQL.
      outer && isDrizzleWrapper(outer) && cause === outer
        ? "Database query failed"
        : message,
    ),
  };
}
