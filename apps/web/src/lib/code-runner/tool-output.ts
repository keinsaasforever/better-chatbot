import type { CodeRunnerResult } from "./code-runner.interface";

/**
 * What the model is told to do with a run's output. Appended to every code tool
 * result so the guidance is identical whether the browser or the server ran it.
 */
export const CODE_EXECUTION_GUIDE =
  "Execution finished. Provide: 1) Main results/outputs 2) Key insights or findings 3) Error explanations if any. Don't repeat code or raw logs - interpret and summarize for the user. Generated files listed in `artifacts` are already shown to the user as file cards with a Download button, directly in the chat. Refer to them by filename in plain text (e.g. report.xlsx). Never write a link, URL or path for them: sandbox:/…, file:// and /home/user/… links do not work for the user. Do not re-create their content.";

/** Serialized-log budget past which logs are replaced by a notice. */
const MAX_TOOL_LOG_CHARS = 5000;

const TRUNCATED_LOGS: CodeRunnerResult["logs"] = [
  {
    type: "info",
    args: [
      {
        type: "data",
        value:
          "Log output exceeded storage limit (10KB). Full output was displayed to user but truncated for server storage.",
      },
    ],
  },
];

/**
 * Shapes a raw run into the tool output sent to the model and persisted.
 *
 * Two things must never survive this step: oversized logs, and artifact BYTES
 * (`bytes` from collection, or the small `contentBase64` fallback `e2bRun`
 * keeps when an upload failed). Passing a result through untouched could push
 * megabytes into the model's context and the message row. Only the metadata
 * (and the durable `url`, which survives a refresh) is kept — the fields are
 * picked explicitly so nothing else can leak in.
 *
 * Shared by the browser path (`CodeExecutor`) and the headless server tools, so
 * a scheduled run's transcript renders exactly like an interactive one.
 */
export function toCodeToolOutput(
  result: CodeRunnerResult,
): Record<string, unknown> {
  const oversized = JSON.stringify(result.logs).length > MAX_TOOL_LOG_CHARS;
  return {
    ...result,
    logs: oversized ? TRUNCATED_LOGS : result.logs,
    artifacts: result.artifacts?.map(
      ({ filename, mimeType, url, sizeBytes, contentBase64, error }) => ({
        filename,
        mimeType,
        url,
        sizeBytes:
          sizeBytes ??
          (contentBase64
            ? Math.round((contentBase64.length * 3) / 4)
            : undefined),
        error,
      }),
    ),
    guide: CODE_EXECUTION_GUIDE,
  };
}

/**
 * Turns a thrown error into a normal failure result. A code run that rejects
 * still has to produce a tool result: the model is waiting on one, and an
 * unanswered tool call stalls the whole turn.
 */
export function errorToCodeRunnerResult(error: unknown): CodeRunnerResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    success: false,
    logs: [{ type: "error", args: [{ type: "data", value: message }] }],
    error: message,
    backend: "e2b",
  };
}
