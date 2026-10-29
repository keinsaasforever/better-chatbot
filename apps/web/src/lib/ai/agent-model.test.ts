import { describe, expect, it } from "vitest";
import { formatAgentModel, parseAgentModel } from "./agent-model";

describe("agent model encoding", () => {
  it("round-trips provider/model pairs", () => {
    const model = { provider: "anthropic", model: "claude-sonnet-5" };
    expect(parseAgentModel(formatAgentModel(model))).toEqual(model);
  });

  it("keeps slashes inside the model id", () => {
    expect(parseAgentModel("openRouter/meta/llama-3.3-70b")).toEqual({
      provider: "openRouter",
      model: "meta/llama-3.3-70b",
    });
  });

  it("returns null for empty or malformed values", () => {
    expect(parseAgentModel(null)).toBeNull();
    expect(parseAgentModel(undefined)).toBeNull();
    expect(parseAgentModel("")).toBeNull();
    expect(parseAgentModel("noSlash")).toBeNull();
    expect(parseAgentModel("/model-only")).toBeNull();
    expect(parseAgentModel("provider/")).toBeNull();
  });
});
