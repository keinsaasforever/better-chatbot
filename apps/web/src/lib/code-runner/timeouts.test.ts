import { describe, expect, it } from "vitest";
import {
  INTERACTIVE_EXECUTION_TIMEOUT_MS,
  MAX_EXECUTION_TIMEOUT_MS,
  SERVER_TOOL_EXECUTION_TIMEOUT_MS,
  SERVER_TOOL_STEP_BUDGET_MS,
} from "./timeouts";

describe("code execution timeouts", () => {
  it("lets an interactive run ask for no more than the route accepts", () => {
    expect(INTERACTIVE_EXECUTION_TIMEOUT_MS).toBeLessThanOrEqual(
      MAX_EXECUTION_TIMEOUT_MS,
    );
  });

  it("leaves the chat route room to create the sandbox and upload artifacts around a server-side run", () => {
    expect(
      SERVER_TOOL_STEP_BUDGET_MS - SERVER_TOOL_EXECUTION_TIMEOUT_MS,
    ).toBeGreaterThanOrEqual(30_000);
  });
});
