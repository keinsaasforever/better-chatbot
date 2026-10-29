import { describe, expect, it } from "vitest";
import {
  buildCitationSystemPrompt,
  getCitationsForIndex,
  hasCitationMarkup,
  parseCitations,
} from "./parse-citations";

describe("parseCitations", () => {
  it("parses inline text and citation block", () => {
    const input = `The clause limits liability [1].

<CITATIONS>
[1] "maximum aggregate liability shall not exceed" — Contract.pdf
</CITATIONS>`;

    const { text, citations } = parseCitations(input);

    expect(text).toBe("The clause limits liability [1].");
    expect(citations).toEqual([
      {
        index: 1,
        quote: "maximum aggregate liability shall not exceed",
        documentTitle: "Contract.pdf",
      },
    ]);
  });

  it("parses multiple citations", () => {
    const input = `First [1] and second [2].

<CITATIONS>
[1] "quote one" — Doc A
[2] "quote two" — Doc B
</CITATIONS>`;

    const { citations } = parseCitations(input);
    expect(citations).toHaveLength(2);
    expect(citations[1].documentTitle).toBe("Doc B");
  });

  it("parses documentId suffix in citation block", () => {
    const input = `<CITATIONS>
[1] "quoted text" — Report.pdf | documentId: abc-123-def
</CITATIONS>`;

    const { citations } = parseCitations(input);
    expect(citations[0]).toEqual({
      index: 1,
      quote: "quoted text",
      documentTitle: "Report.pdf",
      documentId: "abc-123-def",
    });
  });

  it("returns original text when no citation block exists", () => {
    const input = "Plain answer without citations.";
    const { text, citations } = parseCitations(input);
    expect(text).toBe(input);
    expect(citations).toEqual([]);
  });
});

describe("hasCitationMarkup", () => {
  it("detects citation block and inline markers", () => {
    expect(hasCitationMarkup("text [1]")).toBe(true);
    expect(hasCitationMarkup('<CITATIONS>\n[1] "q" — D\n</CITATIONS>')).toBe(
      true,
    );
    expect(hasCitationMarkup("plain text")).toBe(false);
  });
});

describe("getCitationsForIndex", () => {
  it("filters citations by index", () => {
    const citations = [
      { index: 1, quote: "a" },
      { index: 2, quote: "b" },
    ];
    expect(getCitationsForIndex(citations, 1)).toEqual([
      { index: 1, quote: "a" },
    ]);
  });
});

describe("buildCitationSystemPrompt", () => {
  it("returns empty string for no documents", () => {
    expect(buildCitationSystemPrompt([])).toBe("");
  });

  it("includes document list and rules", () => {
    const prompt = buildCitationSystemPrompt([
      { id: "abc", title: "Report.pdf" },
    ]);
    expect(prompt).toContain("Report.pdf");
    expect(prompt).toContain("<CITATIONS>");
  });
});
