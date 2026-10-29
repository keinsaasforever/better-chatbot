import { DefaultToolName } from "lib/ai/tools";
import { describe, expect, it } from "vitest";
import { buildMessageDisplayItems } from "./tool-part-grouping";

const toolPart = (name: string, state = "output-available") =>
  ({
    type: `tool-${name}`,
    toolCallId: `call-${name}-${state}`,
    state,
    input: {},
    output: {},
  }) as any;

const reasoning = (text = "thinking") => ({ type: "reasoning", text }) as any;
const text = (value = "hello") => ({ type: "text", text: value }) as any;

describe("buildMessageDisplayItems", () => {
  it("folds consecutive tool calls and the reasoning between them into one group", () => {
    const parts = [
      toolPart("Twenty_get_activities"),
      reasoning(),
      toolPart("Twenty_get_tasks"),
      toolPart("Twenty_get_activities"),
      reasoning("final thought"),
      text(),
    ];

    const items = buildMessageDisplayItems(parts);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: "tool-group", index: 0 });
    expect(
      items[0].kind === "tool-group" ? items[0].parts.map((p) => p.index) : [],
    ).toEqual([0, 1, 2, 3]);
    // Trailing reasoning leads into the answer, so it stays visible.
    expect(items[1]).toMatchObject({ kind: "part", index: 4 });
    expect(items[2]).toMatchObject({ kind: "part", index: 5 });
  });

  it("leaves a lone tool call ungrouped", () => {
    const items = buildMessageDisplayItems([
      toolPart("Twenty_get_activities"),
      text(),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["part", "part"]);
  });

  it("never groups tools that render their own UI", () => {
    const items = buildMessageDisplayItems([
      toolPart(DefaultToolName.WebSearch),
      toolPart(DefaultToolName.CreateBarChart),
    ]);

    expect(items.map((item) => item.kind)).toEqual(["part", "part"]);
  });

  it("keeps a tool call awaiting manual approval out of the group", () => {
    const parts = [
      toolPart("Twenty_get_activities"),
      toolPart("Twenty_get_tasks"),
      toolPart("Twenty_create_task", "input-available"),
    ];

    const items = buildMessageDisplayItems(parts, { pinnedIndex: 2 });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "tool-group", index: 0 });
    expect(
      items[0].kind === "tool-group" ? items[0].parts.map((p) => p.index) : [],
    ).toEqual([0, 1]);
    expect(items[1]).toMatchObject({ kind: "part", index: 2 });
  });
});
