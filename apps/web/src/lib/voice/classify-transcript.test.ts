import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let TranscriptClassificationSchema: Awaited<
  typeof import("./classify-transcript")
>["TranscriptClassificationSchema"];

beforeAll(async () => {
  ({ TranscriptClassificationSchema } = await import("./classify-transcript"));
});

describe("TranscriptClassificationSchema", () => {
  it("accepts null optional nested objects from model output", () => {
    const parsed = TranscriptClassificationSchema.parse({
      intent: "task",
      title: "Send integration email",
      project: null,
      schedule: null,
      agent: null,
    });

    expect(parsed.intent).toBe("task");
    expect(parsed.projectName).toBeNull();
    expect(parsed.schedule).toBeNull();
    expect(parsed.agent).toBeNull();
  });
});
