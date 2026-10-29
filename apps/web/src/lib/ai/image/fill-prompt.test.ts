import { describe, expect, it } from "vitest";
import {
  MAX_FILL_PROMPT_CHARS,
  resolveImageApiText,
  toFillPrompt,
} from "./fill-prompt";

describe("toFillPrompt", () => {
  it("keeps a description of the finished region", () => {
    expect(toFillPrompt("clean white background", "remove")).toBe(
      "clean white background",
    );
  });

  it("drops the quoted words a removal must not paint back", () => {
    // The staging failure: the literal reached FLUX Fill, which rendered it
    // again in a font of its own choosing.
    expect(
      toFillPrompt(
        'Remove the text "3x RESEARCH OUTPUT." at the top, leaving only the clean white background',
        "remove",
      ),
    ).toBe(
      "Remove the text at the top, leaving only the clean white background",
    );
  });

  it.each([
    ["“", "”"],
    ["„", "“"],
    ["«", "»"],
  ])("drops %s%s quotes too", (open, close) => {
    expect(
      toFillPrompt(`plain wall without ${open}SALE${close}`, "remove"),
    ).toBe("plain wall without");
  });

  it("keeps quoted words on a replacement — they are what to paint", () => {
    expect(toFillPrompt('the word "SALE" in bold red letters', "replace")).toBe(
      'the word "SALE" in bold red letters',
    );
  });

  it("leaves an apostrophe alone", () => {
    expect(toFillPrompt("the wall behind the baker's sign", "remove")).toBe(
      "the wall behind the baker's sign",
    );
  });

  it("returns empty when nothing but the quote was there", () => {
    expect(toFillPrompt('"3x RESEARCH OUTPUT."', "remove")).toBe("");
  });

  it("still strips what the composer added", () => {
    expect(
      toFillPrompt(
        "plain white background https://storage.example.com/a.png",
        null,
      ),
    ).toBe("plain white background");
  });

  it("caps the prompt", () => {
    expect(toFillPrompt("wall ".repeat(200), "replace")).toHaveLength(
      MAX_FILL_PROMPT_CHARS - 1,
    );
  });
});

describe("resolveImageApiText", () => {
  const messages = [
    { role: "user" as const, content: "delete the writing up there" },
  ];

  it("prefers the model's own prompt", () => {
    expect(
      resolveImageApiText({ prompt: "plain wall", messages, hasMask: true }),
    ).toBe("plain wall");
  });

  it("falls back to the user's words without a mask", () => {
    expect(resolveImageApiText({ prompt: "", messages })).toBe(
      "delete the writing up there",
    );
  });

  it("never falls back to the instruction on a masked call", () => {
    expect(resolveImageApiText({ prompt: "", messages, hasMask: true })).toBe(
      "",
    );
  });
});
