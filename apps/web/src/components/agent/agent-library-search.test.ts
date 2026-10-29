import { describe, expect, it } from "vitest";
import { PRESET_AGENTS } from "lib/ai/agent/presets";
import { matchesPresetQuery } from "./agent-library-drawer";

const preset = (overrides: Partial<(typeof PRESET_AGENTS)[number]> = {}) =>
  ({
    ...PRESET_AGENTS[0],
    name: "Research Agent",
    description: "Find the right leads in minutes using live web search.",
    ...overrides,
  }) as (typeof PRESET_AGENTS)[number];

describe("matchesPresetQuery", () => {
  it("keeps everything when the query is empty or whitespace", () => {
    expect(matchesPresetQuery(preset(), "")).toBe(true);
    expect(matchesPresetQuery(preset(), "   ")).toBe(true);
  });

  it("matches on name, ignoring case", () => {
    expect(matchesPresetQuery(preset(), "research")).toBe(true);
    expect(matchesPresetQuery(preset(), "RESEARCH")).toBe(true);
  });

  it("matches on description, so a query can describe the job", () => {
    expect(matchesPresetQuery(preset(), "leads")).toBe(true);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(matchesPresetQuery(preset(), "  leads  ")).toBe(true);
  });

  it("rejects a term in neither field", () => {
    expect(matchesPresetQuery(preset(), "invoice")).toBe(false);
  });

  it("searches across categories, not just the one in view", () => {
    // The point of the feature: the tabs were previously the only way to
    // browse, so an agent in another category was unreachable.
    const categories = new Set(
      PRESET_AGENTS.filter((p) => matchesPresetQuery(p, "a")).map(
        (p) => p.category,
      ),
    );
    expect(categories.size).toBeGreaterThan(1);
  });
});
