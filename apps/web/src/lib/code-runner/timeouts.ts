/**
 * Execution budgets for the code tools, in one place so the browser request,
 * the route's validation, the headless server tool and the chat step budget
 * cannot drift apart. The interactive default used to be 30 s while the route
 * allowed 60 s, and file-generating runs (a pip install plus the work) were
 * dying at the client's number.
 *
 * Client-safe: no server imports.
 */

/** What an interactive run asks for: a pip install plus the actual work. */
export const INTERACTIVE_EXECUTION_TIMEOUT_MS = 90_000;

/** The most a caller may request from /api/code-execution/e2b. */
export const MAX_EXECUTION_TIMEOUT_MS = 120_000;

/**
 * How long the browser waits on /api/code-execution/e2b before giving up.
 *
 * The fetch had no deadline of any kind: the timeout above travels in the
 * request body as a hint for the sandbox, while the browser itself would wait
 * out the route's `maxDuration` of 300 s. A request that never came back held
 * the tool call open with nothing to cancel it, and on iOS — where the tab can
 * be frozen mid-flight — that is indistinguishable from a hang.
 *
 * The budget is the run plus the allowance the server gives sandbox creation,
 * artifact collection and upload, so aborting here means the server really is
 * not coming back rather than merely being slow.
 */
export const CLIENT_EXECUTION_REQUEST_TIMEOUT_MS = 150_000;

/** Headless (scheduled) runs, executed inside the chat request itself. */
export const SERVER_TOOL_EXECUTION_TIMEOUT_MS = 90_000;

/**
 * Chat route budget for one server-side tool call: sandbox creation, the run
 * above, then collecting and uploading up to 100 MiB of artifacts.
 */
export const SERVER_TOOL_STEP_BUDGET_MS = 150_000;
