import { describe, expect, it } from "vitest";
import {
  detectModelSwitch,
  findPreviousThreadChatModel,
  findPreviousThreadModel,
} from "./model-switch";

const assistant = (provider?: string, model?: string) => ({
  role: "assistant",
  metadata:
    provider && model ? { chatModel: { provider, model } as any } : undefined,
});

const user = () => ({ role: "user", metadata: undefined });

describe("findPreviousThreadModel", () => {
  it("takes the newest assistant message that recorded a model", () => {
    expect(
      findPreviousThreadModel([
        assistant("anthropic", "claude-sonnet-5"),
        user(),
        assistant("openai", "gpt-5.6-sol"),
        user(),
      ]),
    ).toBe("openai/gpt-5.6-sol");
  });

  it("skips user messages, which never carry a model", () => {
    expect(
      findPreviousThreadModel([
        assistant("anthropic", "claude-sonnet-5"),
        user(),
      ]),
    ).toBe("anthropic/claude-sonnet-5");
  });

  it("skips assistant messages with no model rather than giving up", () => {
    expect(
      findPreviousThreadModel([
        assistant("anthropic", "claude-sonnet-5"),
        assistant(),
      ]),
    ).toBe("anthropic/claude-sonnet-5");
  });

  it("is undefined for a new thread", () => {
    expect(findPreviousThreadModel([])).toBeUndefined();
    expect(findPreviousThreadModel(undefined)).toBeUndefined();
  });
});

describe("findPreviousThreadChatModel", () => {
  it("returns the model itself, ready to pin the next turn to", () => {
    expect(
      findPreviousThreadChatModel([
        assistant("anthropic", "claude-sonnet-5"),
        user(),
        assistant("openai", "gpt-5.6-sol"),
        user(),
      ]),
    ).toEqual({ provider: "openai", model: "gpt-5.6-sol" });
  });

  it("skips a half-recorded model rather than pinning to it", () => {
    expect(
      findPreviousThreadChatModel([
        assistant("anthropic", "claude-sonnet-5"),
        { role: "assistant", metadata: { chatModel: { provider: "openai" } } },
      ] as any),
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-5" });
  });

  it("is undefined for a new thread, so its first turn routes on task fit", () => {
    expect(findPreviousThreadChatModel([])).toBeUndefined();
    expect(findPreviousThreadChatModel(undefined)).toBeUndefined();
  });
});

describe("detectModelSwitch", () => {
  const messages = [assistant("anthropic", "claude-sonnet-5")];

  it("reports a switch and who caused it", () => {
    expect(
      detectModelSwitch({
        messages,
        current: { provider: "openai", model: "gpt-5.6-sol" },
        automatic: true,
      }),
    ).toEqual({
      from: "anthropic/claude-sonnet-5",
      to: "openai/gpt-5.6-sol",
      automatic: true,
    });
  });

  it("distinguishes a user switch from a routing one", () => {
    expect(
      detectModelSwitch({
        messages,
        current: { provider: "openai", model: "gpt-5.6-sol" },
        automatic: false,
      })?.automatic,
    ).toBe(false);
  });

  it("stays quiet when the model did not change", () => {
    expect(
      detectModelSwitch({
        messages,
        current: { provider: "anthropic", model: "claude-sonnet-5" },
        automatic: false,
      }),
    ).toBeUndefined();
  });

  it("stays quiet on the first turn of a thread", () => {
    expect(
      detectModelSwitch({
        messages: [],
        current: { provider: "anthropic", model: "claude-sonnet-5" },
        automatic: false,
      }),
    ).toBeUndefined();
  });

  it("stays quiet when the current model is not fully known", () => {
    expect(
      detectModelSwitch({ messages, current: undefined, automatic: false }),
    ).toBeUndefined();
    expect(
      detectModelSwitch({
        messages,
        current: { provider: "openai" },
        automatic: false,
      }),
    ).toBeUndefined();
  });
});
