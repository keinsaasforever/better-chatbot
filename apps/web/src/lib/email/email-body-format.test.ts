import { describe, expect, it } from "vitest";
import {
  hasMarkdownSyntax,
  markdownToHtmlEmail,
  markdownToPlainTextEmail,
} from "./email-body-format";

const DRAFT = [
  "Moin Anthony,",
  "",
  "**Das müsstest du dafür tun:**",
  "Du beschreibst mir kurz deine Zielkunden.",
  "",
  "**Was wir dir liefern:**",
  "- Interessante Unternehmen mit aktiven Kaufsignalen",
  "- Direkte Ansprechpartner mit Name und Telefonnummer",
].join("\n");

describe("markdownToPlainTextEmail", () => {
  it("resolves the markdown a model writes into readable plain text", () => {
    expect(markdownToPlainTextEmail(DRAFT)).toBe(
      [
        "Moin Anthony,",
        "",
        "Das müsstest du dafür tun:",
        "Du beschreibst mir kurz deine Zielkunden.",
        "",
        "Was wir dir liefern:",
        "• Interessante Unternehmen mit aktiven Kaufsignalen",
        "• Direkte Ansprechpartner mit Name und Telefonnummer",
      ].join("\n"),
    );
  });

  it("keeps link targets, which a plain-text reader cannot click through to", () => {
    expect(
      markdownToPlainTextEmail("Buch dir [einen Termin](https://cal.com/paul)"),
    ).toBe("Buch dir einen Termin (https://cal.com/paul)");
  });

  it("leaves text that only looks like markdown alone", () => {
    const body = "Preis: 2 * 3 EUR für user_id und snake_case_names";
    expect(markdownToPlainTextEmail(body)).toBe(body);
  });

  it("returns an empty string for an empty body", () => {
    expect(markdownToPlainTextEmail("")).toBe("");
  });
});

describe("markdownToHtmlEmail", () => {
  it("renders emphasis and bullets as HTML", () => {
    const html = markdownToHtmlEmail(DRAFT);
    expect(html).toContain("<strong>Das müsstest du dafür tun:</strong>");
    expect(html).toContain(
      '<li style="margin:0 0 4px 0;">Interessante Unternehmen mit aktiven Kaufsignalen</li>',
    );
    expect(html).not.toContain("**");
  });

  it("keeps consecutive lines in one paragraph but separates blank-line blocks", () => {
    const html = markdownToHtmlEmail("Zeile eins\nZeile zwei\n\nNeuer Absatz");
    expect(html).toContain("Zeile eins<br />Zeile zwei");
    expect(html).toContain(">Neuer Absatz</p>");
  });

  it("escapes user content so a draft cannot inject markup", () => {
    const html = markdownToHtmlEmail(
      'Preis < 5 & "gut" <script>alert(1)</script>',
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("turns links into anchors", () => {
    expect(markdownToHtmlEmail("[Termin](https://cal.com/paul)")).toContain(
      '<a href="https://cal.com/paul">Termin</a>',
    );
  });

  it("degrades an unsafe link scheme to text instead of an anchor", () => {
    const html = markdownToHtmlEmail("[klick](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("klick");
  });

  it("returns an empty string for an empty body", () => {
    expect(markdownToHtmlEmail("")).toBe("");
  });
});

describe("hasMarkdownSyntax", () => {
  it("detects emphasis that would leak into a sent email", () => {
    expect(hasMarkdownSyntax("**fett**")).toBe(true);
  });

  it("is stable across repeated calls despite global regexes", () => {
    expect(hasMarkdownSyntax("**fett**")).toBe(true);
    expect(hasMarkdownSyntax("**fett**")).toBe(true);
  });

  it("does not flag a plain bullet list", () => {
    expect(hasMarkdownSyntax("- eins\n- zwei")).toBe(false);
  });
});
