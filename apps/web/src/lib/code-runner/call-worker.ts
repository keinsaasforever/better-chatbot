"use client";
import { createDebounce, generateUUID } from "lib/utils";
import {
  CodeRunnerOptions,
  CodeRunnerResult,
  CodeWorkerRequest,
  CodeWorkerResponse,
} from "./code-runner.interface";
import { CLIENT_EXECUTION_REQUEST_TIMEOUT_MS } from "./timeouts";

/**
 * Try E2B server-side execution.
 * Returns null only when the E2B route could not be reached (network error or
 * non-2xx response). Returns a CodeRunnerResult whenever E2B responded — even
 * if the user's code threw, or E2B reported a config/quota error (`success:
 * false`). The caller surfaces that result rather than silently switching
 * backends.
 */
async function callE2BApi(
  type: "javascript" | "python",
  option: CodeRunnerOptions,
): Promise<CodeRunnerResult | null> {
  // Without this the browser waits out the route's own `maxDuration` (300 s):
  // `option.timeout` is only a hint carried in the body for the sandbox, never
  // a deadline on the request. A run that never answers then holds the tool
  // call open with nothing to cancel it, which on iOS — where the tab can be
  // frozen mid-flight — is indistinguishable from a hang.
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(),
    CLIENT_EXECUTION_REQUEST_TIMEOUT_MS,
  );
  try {
    const response = await fetch("/api/code-execution/e2b", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: option.code,
        type,
        timeout: option.timeout,
        threadId: option.threadId,
        agentId: option.agentId,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as CodeRunnerResult;
  } catch {
    // A timeout is not the same failure as an unreachable route, and the model
    // can act on the difference. Returning null for both would report "the
    // sandbox could not be reached" for a run that was simply too slow.
    if (controller.signal.aborted) return executionTimedOutResult();
    return null;
  } finally {
    clearTimeout(deadline);
  }
}

/** Shown when the run outlived the client's deadline. */
function executionTimedOutResult(): CodeRunnerResult {
  const message =
    "Code execution timed out before the sandbox returned a result. The run may have been too slow, or the connection was interrupted — try again, or simplify the code.";
  return {
    success: false,
    logs: [{ type: "error", args: [{ type: "data", value: message }] }],
    error: message,
    backend: "e2b",
  };
}

/** Shown when E2B is the configured backend but couldn't be reached. */
function serviceUnavailableResult(): CodeRunnerResult {
  const message =
    "Code execution is temporarily unavailable — the cloud sandbox could not be reached. Please try again.";
  return {
    success: false,
    logs: [{ type: "error", args: [{ type: "data", value: message }] }],
    error: message,
    backend: "e2b",
  };
}

function callLocalWorker(
  type: "javascript" | "python",
  option: CodeRunnerOptions,
): Promise<CodeRunnerResult> {
  let tk: NodeJS.Timeout;
  const terminateDebounce = createDebounce();
  const terminate = () => {
    terminateDebounce(() => {
      worker.terminate();
    }, 5000);
  };
  let isWorking = true;
  const worker = new Worker(new URL("./worker.ts", import.meta.url));
  const promise = new Promise<CodeRunnerResult>((resolve) => {
    const id = generateUUID();
    const request: CodeWorkerRequest = {
      id,
      type,
      code: option.code,
      timeout: option.timeout,
    };
    setTimeout(() => {
      worker.postMessage(request);
    }, 1000); // for boot-up effect
    worker.onmessage = (event) => {
      const response = event.data as CodeWorkerResponse;
      if (response.id !== id) return;
      if (response.type === "log") {
        option.onLog?.(response.entry);
        if (!isWorking) terminate();
      } else {
        resolve(response.result as CodeRunnerResult);
        clearTimeout(tk);
        terminate();
      }
    };
  });

  const race = Promise.race([
    promise,
    new Promise<CodeRunnerResult>((timeout) => {
      tk = setTimeout(() => {
        const errorResult: CodeRunnerResult = {
          success: false,
          logs: [
            {
              type: "error",
              args: [
                {
                  type: "data",
                  value: JSON.stringify({
                    type: "error",
                    message: "Timeout",
                  }),
                },
              ],
            },
          ],
          error: "Timeout",
        };
        timeout(errorResult);
        terminate();
      }, option.timeout || 40000);
    }),
  ]);

  return race.finally(() => {
    isWorking = false;
  });
}

/**
 * Run code, choosing the backend by NEXT_PUBLIC_CODE_EXECUTION_BACKEND:
 *
 * - "local" → in-browser Web Worker only (opt-in for deployments with no E2B
 *   key). The browser sandbox can't pip-install libraries or produce
 *   downloadable files.
 * - default / "e2b" → E2B cloud sandbox. On failure we surface an error rather
 *   than silently falling back to the browser sandbox — a silent switch runs
 *   code in an environment that can't install packages or write files, which
 *   produces confusing, unreliable results (e.g. PDF generation fails).
 */
export function callCodeRunWorker(
  type: "javascript" | "python",
  option: CodeRunnerOptions,
): Promise<CodeRunnerResult> {
  if (process.env.NEXT_PUBLIC_CODE_EXECUTION_BACKEND === "local") {
    return callLocalWorker(type, option).then((result) => ({
      ...result,
      backend: result.backend ?? "local",
    }));
  }
  return callE2BApi(type, option).then(
    (result) => result ?? serviceUnavailableResult(),
  );
}
