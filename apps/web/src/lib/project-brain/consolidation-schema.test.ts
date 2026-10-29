import { describe, expect, it } from "vitest";
import { ConsolidationSchema } from "./consolidation-schema";

describe("ConsolidationSchema", () => {
  it("fills defaults for a bare object", () => {
    const result = ConsolidationSchema.parse({});

    expect(result).toEqual({
      health: "unknown",
      summary: "",
      blockers: [],
      todos: [],
      resolvedKeys: [],
    });
  });

  it("drops malformed todos instead of rejecting the whole proposal", () => {
    const result = ConsolidationSchema.parse({
      health: "yellow",
      todos: [
        { key: "ok", title: "Fine", priority: "high", notify: true },
        { title: "No key" },
        { key: "bad url", title: "x", sourceUrl: "nope" },
      ],
    });

    expect(result.todos).toHaveLength(1);
    expect(result.todos[0]).toMatchObject({ key: "ok", notify: true });
  });

  it("falls back on unknown health and priority values", () => {
    const result = ConsolidationSchema.parse({
      health: "amber",
      todos: [{ key: "k", title: "t", priority: "urgent" }],
    });

    expect(result.health).toBe("unknown");
    expect(result.todos[0].priority).toBe("normal");
    expect(result.todos[0].notify).toBe(false);
  });
});
