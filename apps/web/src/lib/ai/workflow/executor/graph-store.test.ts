import { describe, expect, it } from "vitest";
import { createGraphStore } from "./graph-store";
import { DBNode } from "app-types/workflow";

describe("workflow-store", () => {
  it("source", () => {
    const store = createGraphStore({
      nodes: [],
      edges: [],
    });
    const context = store();

    expect(context.outputs).toEqual({});
    expect(
      context.getOutput({
        nodeId: "v1",
        path: [],
      }),
    ).toBe(undefined);
    expect(
      context.getOutput({
        nodeId: "v1",
        path: ["person"],
      }),
    ).toBe(undefined);

    context.setOutput(
      {
        nodeId: "v1",
        path: ["person"],
      },
      {
        name: "cgoing",
        age: 30,
      },
    );
    expect(
      context.getOutput({
        nodeId: "v1",
        path: ["person"],
      }),
    ).toEqual({
      name: "cgoing",
      age: 30,
    });

    expect(
      context.getOutput({
        nodeId: "v1",
        path: ["person", "name"],
      }),
    ).toBe("cgoing");

    expect(
      context.getOutput({
        nodeId: "v1",
        path: ["person", "name", "xxx"],
      }),
    ).toBe(undefined);

    context.setOutput(
      {
        nodeId: "v2",
        path: ["person", "name", "xxx"],
      },
      "xxx",
    );

    expect(
      context.getOutput({
        nodeId: "v2",
        path: ["person", "name", "xxx"],
      }),
    ).toBe("xxx");
  });
  it("default value", () => {
    const store = createGraphStore({
      nodes: [
        {
          id: "v1",
          nodeConfig: {
            outputSchema: {
              type: "object",
              properties: {
                name: {
                  type: "string",
                  default: "cgoing",
                },
              },
            },
          },
        } as unknown as DBNode,
      ],
      edges: [],
    });
    const context = store();
    expect(
      context.getOutput({
        nodeId: "v1",
        path: ["name"],
      }),
    ).toBe("cgoing");
  });
});
