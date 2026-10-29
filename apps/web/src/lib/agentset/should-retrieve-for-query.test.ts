import { describe, expect, it } from "vitest";
import { shouldRetrieveForQuery } from "./should-retrieve-for-query";

describe("shouldRetrieveForQuery", () => {
  it("skips greetings and short acknowledgments", () => {
    expect(shouldRetrieveForQuery("hello")).toBe(false);
    expect(shouldRetrieveForQuery("Hi!")).toBe(false);
    expect(shouldRetrieveForQuery("thanks")).toBe(false);
    expect(shouldRetrieveForQuery("ok")).toBe(false);
  });

  it("allows document questions", () => {
    expect(
      shouldRetrieveForQuery("What does chapter 1 say about Baudynamik?"),
    ).toBe(true);
    expect(shouldRetrieveForQuery("Summarize the pitch deck")).toBe(true);
  });

  it("skips emoji-only messages", () => {
    expect(shouldRetrieveForQuery("👍")).toBe(false);
  });
});
