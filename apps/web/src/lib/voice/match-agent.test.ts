import { describe, expect, it } from "vitest";
import { matchAgentByReference } from "./match-agent";

const AGENTS = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Sales" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Support Desk" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Finance" },
];

describe("matchAgentByReference", () => {
  it("matches an exact id, so a model quoting the roster is never second-guessed", () => {
    expect(matchAgentByReference(AGENTS, AGENTS[1].id)?.name).toBe(
      "Support Desk",
    );
  });

  it("matches a name regardless of case", () => {
    expect(matchAgentByReference(AGENTS, "sales")?.id).toBe(AGENTS[0].id);
    expect(matchAgentByReference(AGENTS, "SUPPORT DESK")?.id).toBe(
      AGENTS[1].id,
    );
  });

  /**
   * The case that made this necessary: a speech model says "the Sales agent",
   * never the UUID. Before this, the reference was stored verbatim and the
   * session reconnected to nothing.
   */
  it("matches when the reference wraps the agent's name", () => {
    expect(matchAgentByReference(AGENTS, "the Sales agent")?.id).toBe(
      AGENTS[0].id,
    );
    expect(matchAgentByReference(AGENTS, "unser Finance Agent")?.id).toBe(
      AGENTS[2].id,
    );
  });

  it("matches when the name wraps the reference", () => {
    expect(matchAgentByReference(AGENTS, "Support")?.id).toBe(AGENTS[1].id);
  });

  /**
   * Two candidates means the model should be asked to pick, not silently
   * handed whichever sorted first.
   */
  it("refuses an ambiguous partial match", () => {
    const ambiguous = [
      { id: "a", name: "Sales EU" },
      { id: "b", name: "Sales US" },
    ];
    expect(matchAgentByReference(ambiguous, "Sales")).toBeNull();
    // An exact name still wins over the ambiguity.
    expect(matchAgentByReference(ambiguous, "Sales EU")?.id).toBe("a");
  });

  it("returns null for no match, an empty reference, or no agents", () => {
    expect(matchAgentByReference(AGENTS, "Marketing")).toBeNull();
    expect(matchAgentByReference(AGENTS, "   ")).toBeNull();
    expect(matchAgentByReference([], "Sales")).toBeNull();
  });
});
