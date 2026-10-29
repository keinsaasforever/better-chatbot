import { describe, expect, it } from "vitest";
import { normalizeAgentInstructions } from "./normalize";

describe("normalizeAgentInstructions", () => {
  it("reads a legacy row forward without loss", () => {
    // The exact shape stored today: role + systemPrompt + a flat mentions blob
    // + knowledgeBases. Nothing migrated; the normalizer just splits it.
    const legacy = {
      role: "sales analyst",
      systemPrompt: "Be concise.",
      mentions: [
        { type: "defaultTool" as const, name: "webSearch", label: "Web" },
        {
          type: "mcpServer" as const,
          name: "todoist",
          serverId: "srv-1",
        },
        { type: "skill" as const, name: "invoice", skillId: "sk-1" },
      ],
      knowledgeBases: [
        { type: "kb" as const, id: "11111111-1111-1111-1111-111111111111" },
      ],
    };

    const def = normalizeAgentInstructions(legacy);

    expect(def.role).toBe("sales analyst");
    expect(def.systemPrompt).toBe("Be concise.");
    // Skills split out of the flat mentions list...
    expect(def.skills).toHaveLength(1);
    expect(def.skills[0].name).toBe("invoice");
    // ...tools keep the rest, in order, and no mention is dropped.
    expect(def.tools.map((t) => t.name)).toEqual(["webSearch", "todoist"]);
    expect(def.knowledgeBases).toEqual(legacy.knowledgeBases);
    expect(def.tools.length + def.skills.length).toBe(legacy.mentions.length);
  });

  it("does not classify a nested agent mention as a tool", () => {
    const def = normalizeAgentInstructions({
      mentions: [
        { type: "agent" as const, name: "sub", agentId: "a-1" },
        { type: "defaultTool" as const, name: "http", label: "HTTP" },
      ],
    });
    expect(def.tools.map((t) => t.name)).toEqual(["http"]);
    expect(def.skills).toHaveLength(0);
  });

  it("tolerates null / empty instructions", () => {
    const def = normalizeAgentInstructions(null);
    expect(def).toEqual({
      role: undefined,
      systemPrompt: undefined,
      tools: [],
      skills: [],
      knowledgeBases: [],
    });
  });
});
