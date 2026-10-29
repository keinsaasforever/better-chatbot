import { describe, expect, test } from "vitest";
import { DefaultToolName } from "lib/ai/tools";
import { defaultToolMentionsFromNames } from "./default-tool-mentions";

describe("defaultToolMentionsFromNames", () => {
  test("maps known tool names to defaultTool mentions", () => {
    expect(
      defaultToolMentionsFromNames([DefaultToolName.PythonExecution]),
    ).toEqual([
      {
        type: "defaultTool",
        name: DefaultToolName.PythonExecution,
        label: DefaultToolName.PythonExecution,
      },
    ]);
  });

  test("drops names that are not real tools", () => {
    // The list comes from a model, so a hallucinated name must not be stored
    // on the agent where it would resolve to nothing forever.
    expect(
      defaultToolMentionsFromNames(["definitely-not-a-tool", "createPdf"]),
    ).toEqual([]);
  });

  test("returns nothing for an empty or missing list", () => {
    expect(defaultToolMentionsFromNames(undefined)).toEqual([]);
    expect(defaultToolMentionsFromNames([])).toEqual([]);
  });

  test("does not duplicate a name that is requested twice", () => {
    expect(
      defaultToolMentionsFromNames([
        DefaultToolName.WebSearch,
        DefaultToolName.WebSearch,
      ]),
    ).toHaveLength(1);
  });
});
