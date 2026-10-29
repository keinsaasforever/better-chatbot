import { describe, expect, it } from "vitest";
import { createPlanInputSchema, createPlanTool } from "./create-plan-tool";

describe("createPlanTool", () => {
  it("accepts a valid plan", () => {
    const result = createPlanInputSchema.safeParse({
      title: "Migrate the billing service",
      description: "Two-phase rollout with a feature flag.",
      steps: [
        { title: "Inventory current usage", description: null },
        { title: "Ship behind a flag", description: "Staging first." },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a plan without steps", () => {
    const result = createPlanInputSchema.safeParse({
      title: "Empty",
      description: null,
      steps: [],
    });
    expect(result.success).toBe(false);
  });

  it("execute settles the call without doing work", async () => {
    await expect(
      (createPlanTool.execute as () => Promise<string>)(),
    ).resolves.toBe("Success");
  });
});
