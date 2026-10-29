import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: (...args: unknown[]) => mocks.generateObject(...args),
  generateText: (...args: unknown[]) => mocks.generateText(...args),
}));

const {
  extractJsonObject,
  generateObjectResilient,
  GenerationAbortedError,
  isGenerationAbortedError,
} = await import("./resilient-object");

describe("extractJsonObject", () => {
  it("parses plain JSON", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown fences", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("ignores prose around the object", () => {
    expect(
      extractJsonObject('Here is the result:\n{"a":{"b":2}}\nHope that helps!'),
    ).toEqual({ a: { b: 2 } });
  });

  it("handles fenced JSON with prose outside the fence", () => {
    expect(
      extractJsonObject('Sure! ```json\n{"todos":[]}\n``` Let me know.'),
    ).toEqual({ todos: [] });
  });

  it("throws when there is no JSON object", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });

  it("throws on malformed JSON", () => {
    expect(() => extractJsonObject('{"a":')).toThrow();
  });
});

describe("generateObjectResilient abort signal", () => {
  const schema = z.object({ ok: z.boolean() });

  function run(abortSignal: AbortSignal) {
    return generateObjectResilient({
      model: "primary-model",
      fallbackModel: "fallback-model",
      schema,
      system: "sys",
      prompt: "prompt",
      abortSignal,
    });
  }

  it("passes the signal to the primary attempt", async () => {
    mocks.generateObject.mockReset();
    mocks.generateText.mockReset();
    mocks.generateObject.mockResolvedValue({ object: { ok: true } });
    const signal = AbortSignal.timeout(10_000);

    await run(signal);

    expect(mocks.generateObject.mock.calls[0][0].abortSignal).toBe(signal);
  });

  it("passes the signal to every fallback layer", async () => {
    // All three attempts are sequential, so a caller on a deadline needs the
    // bound to apply to the whole chain, not just the first call.
    mocks.generateObject.mockReset();
    mocks.generateText.mockReset();
    mocks.generateObject
      .mockRejectedValueOnce(new Error("strict parse failed"))
      .mockResolvedValueOnce({ object: { ok: true } });
    mocks.generateText.mockRejectedValue(new Error("repair failed"));
    const signal = AbortSignal.timeout(10_000);

    const result = await run(signal);

    expect(result.via).toBe("fallback");
    expect(mocks.generateObject.mock.calls[0][0].abortSignal).toBe(signal);
    expect(mocks.generateText.mock.calls[0][0].abortSignal).toBe(signal);
    expect(mocks.generateObject.mock.calls[1][0].abortSignal).toBe(signal);
  });

  it("stops at the first attempt once the signal has fired", async () => {
    // The AI SDK reports an abort as `DOMException: Delay was aborted`, which
    // names neither the caller nor the deadline; its `code` of 20 is also what
    // OTel records as the exception type. Both make the incident unreadable.
    mocks.generateObject.mockReset();
    mocks.generateText.mockReset();
    const controller = new AbortController();
    mocks.generateObject.mockImplementation(() => {
      controller.abort();
      return Promise.reject(
        new DOMException("Delay was aborted", "AbortError"),
      );
    });

    await expect(run(controller.signal)).rejects.toBeInstanceOf(
      GenerationAbortedError,
    );

    // No doomed text-repair or fallback call against an already-dead signal.
    expect(mocks.generateObject).toHaveBeenCalledTimes(1);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("reports the original failure when the signal never fired", async () => {
    mocks.generateObject.mockReset();
    mocks.generateText.mockReset();
    mocks.generateObject.mockRejectedValue(new Error("strict parse failed"));
    mocks.generateText.mockRejectedValue(new Error("repair failed"));

    await expect(run(AbortSignal.timeout(10_000))).rejects.toThrow(
      "strict parse failed",
    );
  });
});

describe("isGenerationAbortedError", () => {
  it("matches the class", () => {
    expect(isGenerationAbortedError(new GenerationAbortedError("x"))).toBe(
      true,
    );
  });

  it("matches an error replayed by Inngest, which loses the prototype", () => {
    expect(
      isGenerationAbortedError(
        Object.assign(new Error("boom"), { name: "GenerationAbortedError" }),
      ),
    ).toBe(true);
  });

  it("does not match anything else", () => {
    expect(isGenerationAbortedError(new Error("boom"))).toBe(false);
    expect(isGenerationAbortedError(null)).toBe(false);
  });
});
