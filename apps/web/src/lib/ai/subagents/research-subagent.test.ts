import { MockLanguageModelV4, convertArrayToReadableStream } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  type ResearchToolOutput,
  createResearchAgentTool,
} from "./research-subagent";

const streamingTextModel = () =>
  new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "1" },
        { type: "text-delta", id: "1", delta: "Finding A. " },
        { type: "text-delta", id: "1", delta: "Finding B." },
        { type: "text-end", id: "1" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 3, outputTokens: 7, totalTokens: 10 },
        },
      ] as any),
    }),
  });

const runExecute = async (tool: ReturnType<typeof createResearchAgentTool>) => {
  const outputs: ResearchToolOutput[] = [];
  const iterable = tool.execute!(
    { task: "What is the answer?" },
    { toolCallId: "call-1", messages: [], context: {} },
  ) as AsyncIterable<ResearchToolOutput>;
  for await (const output of iterable) {
    outputs.push(output);
  }
  return outputs;
};

describe("createResearchAgentTool", () => {
  it("streams preliminary progress and ends with a compact summary", async () => {
    const tool = createResearchAgentTool({ model: streamingTextModel() });
    const outputs = await runExecute(tool);

    expect(outputs.length).toBeGreaterThan(1);
    for (const output of outputs.slice(0, -1)) {
      expect(output.status).toBe("running");
    }

    const final = outputs.at(-1)!;
    expect(final).toEqual({
      status: "done",
      summary: "Finding A. Finding B.",
      toolCallCount: 0,
    });
  });

  it("toModelOutput hands the model only the summary text", () => {
    const tool = createResearchAgentTool({ model: streamingTextModel() });
    expect(
      tool.toModelOutput!({
        toolCallId: "call-1",
        input: { task: "q" },
        output: {
          status: "done",
          summary: "Only this reaches the main agent.",
          toolCallCount: 2,
        },
      }),
    ).toEqual({ type: "text", value: "Only this reaches the main agent." });
    expect(
      tool.toModelOutput!({
        toolCallId: "call-1",
        input: { task: "q" },
        output: {
          status: "running",
          message: { id: "m", role: "assistant", parts: [] },
        },
      }),
    ).toEqual({ type: "text", value: "Research in progress." });
  });
});
