import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  pipeline: vi.fn(),
  updates: [] as Record<string, unknown>[],
}));

vi.mock("./run-pipeline", () => ({
  TERMINAL_STATUSES: ["succeeded", "partial", "skipped", "failed"],
  runProjectBrainPipeline: (input: unknown) => mocks.pipeline(input),
}));

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.updates.push(values);
        return { where: () => Promise.resolve() };
      },
    }),
  },
}));

import { PROJECT_BRAIN_INLINE_RUN_BUDGET_MS } from "./run-budget";
import { isInngestConfigured, runProjectBrainInline } from "./run-inline";

describe("isInngestConfigured", () => {
  test("needs an event key or the dev server", () => {
    expect(isInngestConfigured({})).toBe(false);
    expect(isInngestConfigured({ INNGEST_EVENT_KEY: "  " })).toBe(false);
    expect(isInngestConfigured({ INNGEST_EVENT_KEY: "key" })).toBe(true);
    expect(isInngestConfigured({ INNGEST_DEV: "1" })).toBe(true);
  });
});

describe("runProjectBrainInline", () => {
  beforeEach(() => {
    mocks.pipeline.mockReset();
    mocks.updates.length = 0;
  });

  test("runs the pipeline with plain steps and the inline budget", async () => {
    mocks.pipeline.mockImplementation(
      async ({
        step,
      }: { step: { run: (n: string, f: () => unknown) => unknown } }) =>
        step.run("load", async () => "loaded"),
    );

    await runProjectBrainInline("run-1");

    const input = mocks.pipeline.mock.calls[0][0];
    expect(input).toMatchObject({
      runId: "run-1",
      budgetMs: PROJECT_BRAIN_INLINE_RUN_BUDGET_MS,
    });
    expect(mocks.updates).toHaveLength(0);
  });

  test("settles the run instead of throwing when the pipeline fails", async () => {
    mocks.pipeline.mockRejectedValue(new Error("db down"));

    await expect(runProjectBrainInline("run-1")).resolves.toBeUndefined();

    expect(mocks.updates[0]).toMatchObject({
      status: "failed",
      errorCode: "pipeline_failed",
    });
  });
});
