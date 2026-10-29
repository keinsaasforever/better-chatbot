import { describe, expect, it } from "vitest";
import {
  MAX_THREAD_TITLE_LENGTH,
  buildThreadTitleSeed,
  deriveThreadTitleFromText,
  extractTitleSeedFromSendMessage,
  normalizeThreadTitle,
} from "./thread-title";

describe("extractTitleSeedFromSendMessage", () => {
  it("extracts user text from a send payload", () => {
    expect(
      extractTitleSeedFromSendMessage({
        role: "user",
        parts: [{ type: "text", text: "Summarize the shareholder agreement" }],
      }),
    ).toBe("user: Summarize the shareholder agreement");
  });

  it("returns null when there is no text to title from", () => {
    expect(
      extractTitleSeedFromSendMessage({
        role: "user",
        parts: [{ type: "file", url: "x", mediaType: "image/png" }],
      } as any),
    ).toBeNull();
  });
});

describe("normalizeThreadTitle", () => {
  it("collapses whitespace and strips surrounding quotes", () => {
    expect(normalizeThreadTitle('  "Quarterly\n  budget review"  ')).toBe(
      "Quarterly budget review",
    );
  });

  it("truncates to the stored maximum", () => {
    const title = normalizeThreadTitle("a".repeat(200));
    expect(title).toHaveLength(MAX_THREAD_TITLE_LENGTH);
  });

  it("returns an empty string for unusable output", () => {
    expect(normalizeThreadTitle("   \n  ")).toBe("");
    expect(normalizeThreadTitle(undefined)).toBe("");
    expect(normalizeThreadTitle(42)).toBe("");
  });
});

describe("deriveThreadTitleFromText", () => {
  it("falls back to the user's own words without the role prefix", () => {
    expect(
      deriveThreadTitleFromText("user: Draft the invoice\n\nassistant: Sure"),
    ).toBe("Draft the invoice");
  });

  it("returns an empty string when there is nothing to derive", () => {
    expect(deriveThreadTitleFromText("")).toBe("");
  });
});

describe("buildThreadTitleSeed", () => {
  it("builds a role-prefixed seed from persisted messages", () => {
    expect(
      buildThreadTitleSeed([
        { role: "user", parts: [{ type: "text", text: "Why is CI red?" }] },
        {
          role: "assistant",
          parts: [
            { type: "reasoning", text: "hmm" },
            { type: "text", text: "A flaky test" },
          ],
        },
      ]),
    ).toBe("user: Why is CI red?\n\nassistant: A flaky test");
  });

  it("ignores messages with no text parts", () => {
    expect(
      buildThreadTitleSeed([
        { role: "user", parts: [{ type: "file", url: "x" }] },
        { role: "assistant", parts: undefined },
      ]),
    ).toBe("");
  });
});
