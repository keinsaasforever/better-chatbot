import { afterEach, describe, expect, test, vi } from "vitest";
import { callCodeRunWorker } from "./call-worker";
import { CLIENT_EXECUTION_REQUEST_TIMEOUT_MS } from "./timeouts";

/**
 * These cover the browser's side of a code run. The E2B fetch used to have no
 * deadline at all, so a request that never answered held the tool call open
 * for the route's whole `maxDuration` with nothing to cancel it.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fetch that never settles unless its abort signal fires. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        });
      }),
  );
}

describe("callCodeRunWorker (e2b backend)", () => {
  test("gives up on a run that never answers, and says so", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());

    const pending = callCodeRunWorker("python", {
      code: "print(1)",
      timeout: 90_000,
    });

    await vi.advanceTimersByTimeAsync(CLIENT_EXECUTION_REQUEST_TIMEOUT_MS);
    const result = await pending;

    expect(result.success).toBe(false);
    // The distinction matters: the model is told the run was too slow, not
    // that the sandbox was unreachable, because those need different retries.
    expect(result.error).toMatch(/timed out/i);
    expect(result.backend).toBe("e2b");
  });

  test("passes an abort signal so the request can be cancelled at all", async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = callCodeRunWorker("python", { code: "print(1)" });
    await vi.advanceTimersByTimeAsync(CLIENT_EXECUTION_REQUEST_TIMEOUT_MS);
    await pending;

    const init = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("reports an unreachable route separately from a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );

    const result = await callCodeRunWorker("python", { code: "print(1)" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be reached/i);
  });

  test("a non-2xx is unreachable, not a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: false, status: 500 })),
    );

    const result = await callCodeRunWorker("python", { code: "print(1)" });

    expect(result.error).toMatch(/could not be reached/i);
  });

  test("returns the sandbox result untouched when the run answers", async () => {
    const runnerResult = {
      success: true,
      logs: [],
      artifacts: [{ filename: "lv.xlsx" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: () => runnerResult })),
    );

    const result = await callCodeRunWorker("python", { code: "print(1)" });

    expect(result).toEqual(runnerResult);
  });
});
