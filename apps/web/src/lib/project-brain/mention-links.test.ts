import { describe, expect, it } from "vitest";
import { findMentions } from "./mention-links";

const aliases = [
  { pageId: "alex", normalizedAlias: "alexander wessels" },
  { pageId: "alex", normalizedAlias: "alex" },
  { pageId: "moebel", normalizedAlias: "moebel.de" },
  { pageId: "board", normalizedAlias: "board meeting tallinn" },
  { pageId: "kmd", normalizedAlias: "kmd" },
];

describe("findMentions", () => {
  it("matches aliases case-insensitively on word boundaries", () => {
    expect(
      findMentions({
        text: "- organizer: Alexander Wessels\n- client: moebel.de weekly",
        aliases,
      }).sort(),
    ).toEqual(["alex", "moebel"]);
  });

  it("does not match inside other words", () => {
    expect(
      findMentions({ text: "alexandria has no alexander here", aliases }),
    ).toEqual([]);
  });

  it("ignores aliases shorter than four characters unless wikilinked", () => {
    expect(findMentions({ text: "the KMD filing is due", aliases })).toEqual(
      [],
    );
    expect(findMentions({ text: "see [[KMD]] for details", aliases })).toEqual([
      "kmd",
    ]);
  });

  it("resolves wikilinks with display text and excludes the page itself", () => {
    expect(
      findMentions({
        text: "prep for [[Board Meeting Tallinn|the board]] with Alexander Wessels",
        aliases,
        selfPageId: "alex",
      }),
    ).toEqual(["board"]);
  });

  it("returns each page once even when several aliases match", () => {
    expect(
      findMentions({ text: "Alex, i.e. Alexander Wessels", aliases }),
    ).toEqual(["alex"]);
  });

  it("handles empty input", () => {
    expect(findMentions({ text: "   ", aliases })).toEqual([]);
    expect(findMentions({ text: "anything", aliases: [] })).toEqual([]);
  });
});
