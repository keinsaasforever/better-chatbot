import { describe, expect, it } from "vitest";
import { TextSourceSchema } from "./text-source-schema";

describe("TextSourceSchema", () => {
  it("accepts a transcript with optional title", () => {
    const parsed = TextSourceSchema.safeParse({
      title: "Kickoff call",
      text: "We agreed to launch the pilot with Nordlicht in August.",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects text that is too short to be a useful source", () => {
    expect(TextSourceSchema.safeParse({ text: "too short" }).success).toBe(
      false,
    );
  });

  it("rejects text beyond the 200k character bound", () => {
    expect(
      TextSourceSchema.safeParse({ text: "x".repeat(200_001) }).success,
    ).toBe(false);
  });
});
