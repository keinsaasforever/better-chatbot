import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  span: {
    setAttribute: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  },
  startSpan: vi.fn(),
  add: vi.fn(),
}));

vi.mock("lib/observability/instruments", () => ({
  appTracer: { startSpan: (...args: unknown[]) => mocks.startSpan(...args) },
  jobRuns: { add: (...args: unknown[]) => mocks.add(...args) },
}));

const { otelMiddleware } = await import("./otel-middleware");

/** Drive the middleware the way the SDK does: init → onFunctionRun → hooks. */
function runHooks() {
  const init = otelMiddleware.init as (input: unknown) => any;
  const { onFunctionRun } = init({}) as any;
  return onFunctionRun({ fn: { id: () => "project-brain-ingest-run" } }) as {
    transformOutput: (ctx: { result: any; step?: any }) => void;
    finished: () => void;
  };
}

/** What the SDK passes as `step`: the outgoing op, which never carries the
 * error — a failed step's error only ever arrives on `result`. */
const STEP = { op: "StepRun", name: "extract" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.startSpan.mockReturnValue(mocks.span);
});

describe("otelMiddleware", () => {
  it("counts one success for the function outcome, not for each step", () => {
    const hooks = runHooks();

    hooks.transformOutput({ result: { data: "loaded" }, step: STEP });
    hooks.transformOutput({ result: { data: "extracted" }, step: STEP });
    hooks.transformOutput({ result: { data: "done" } });

    expect(mocks.add).toHaveBeenCalledTimes(1);
    expect(mocks.add).toHaveBeenCalledWith(1, {
      functionId: "project-brain-ingest-run",
      outcome: "success",
    });
  });

  it("records a step failure even though `step` carries no error", () => {
    // A failing step is reported straight back to Inngest as a step result, so
    // it never reaches a function-level rejection in this process. Skipping it
    // here would drop nearly every real job failure.
    const hooks = runHooks();
    const error = new Error("extraction failed");

    hooks.transformOutput({ result: { error }, step: STEP });

    expect(mocks.span.recordException).toHaveBeenCalledWith(error);
    expect(mocks.add).toHaveBeenCalledWith(1, {
      functionId: "project-brain-ingest-run",
      outcome: "failed",
    });
  });

  it("records a function-level failure", () => {
    const hooks = runHooks();
    const error = new Error("budget exhausted");

    hooks.transformOutput({ result: { error } });
    hooks.finished();

    expect(mocks.span.recordException).toHaveBeenCalledWith(error);
    expect(mocks.add).toHaveBeenCalledWith(1, {
      functionId: "project-brain-ingest-run",
      outcome: "failed",
    });
    expect(mocks.span.end).toHaveBeenCalledTimes(1);
  });
});
