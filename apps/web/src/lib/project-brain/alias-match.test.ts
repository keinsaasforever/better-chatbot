import { describe, expect, it } from "vitest";
import { matchAlias, normalizeDomain, tokenize } from "./alias-match";

describe("matchAlias", () => {
  it("matches a person by first name against the full name", () => {
    expect(
      matchAlias({ entityType: "person", title: "Paul" }, [
        { pageId: "p1", normalizedAlias: "paul müller" },
      ]),
    ).toEqual({ pageId: "p1", reason: "token_subset" });
  });

  it("matches the other direction and ignores titles", () => {
    expect(
      matchAlias({ entityType: "person", title: "Dr. Paul Müller" }, [
        { pageId: "p1", normalizedAlias: "paul müller" },
      ]),
    ).toEqual({ pageId: "p1", reason: "token_subset" });
    expect(
      matchAlias({ entityType: "person", title: "Herr Müller" }, [
        { pageId: "p1", normalizedAlias: "paul müller" },
      ]),
    ).toEqual({ pageId: "p1", reason: "token_subset" });
  });

  it("returns null when two different pages qualify", () => {
    expect(
      matchAlias({ entityType: "person", title: "Paul" }, [
        { pageId: "p1", normalizedAlias: "paul müller" },
        { pageId: "p2", normalizedAlias: "paul schmidt" },
      ]),
    ).toBeNull();
  });

  it("prefers an email match over names", () => {
    expect(
      matchAlias(
        { entityType: "person", title: "P. Mueller", email: "PAUL@moebel.de" },
        [
          {
            pageId: "p1",
            normalizedAlias: "paul müller",
            email: "paul@moebel.de",
          },
          { pageId: "p2", normalizedAlias: "paul schmidt" },
        ],
      ),
    ).toEqual({ pageId: "p1", reason: "email" });
  });

  it("matches organizations by domain and strips legal suffixes", () => {
    expect(
      matchAlias(
        {
          entityType: "organization",
          title: "Möbel Shop",
          domain: "https://www.moebel.de/",
        },
        [
          {
            pageId: "o1",
            normalizedAlias: "moebel.de gmbh",
            domain: "moebel.de",
          },
        ],
      ),
    ).toEqual({ pageId: "o1", reason: "domain" });
    expect(
      matchAlias({ entityType: "organization", title: "Planergemeinschaft" }, [
        { pageId: "o2", normalizedAlias: "planergemeinschaft gmbh & co. kg" },
      ]),
    ).toEqual({ pageId: "o2", reason: "token_subset" });
  });

  it("does not fuzzy-match short or non person/organization entities", () => {
    expect(
      matchAlias({ entityType: "person", title: "Al" }, [
        { pageId: "p1", normalizedAlias: "al pacino" },
      ]),
    ).toBeNull();
    expect(
      matchAlias({ entityType: "meeting", title: "Board" }, [
        { pageId: "m1", normalizedAlias: "board meeting tallinn" },
      ]),
    ).toBeNull();
  });
});

describe("helpers", () => {
  it("tokenizes with suffix removal", () => {
    expect(tokenize("Moebel.de GmbH", "organization")).toEqual(["moebel"]);
    expect(tokenize("Dr. Anna Lee", "person")).toEqual(["anna", "lee"]);
  });

  it("normalises domains", () => {
    expect(normalizeDomain("https://www.Moebel.de/shop?x=1")).toBe("moebel.de");
    expect(normalizeDomain(null)).toBeNull();
  });
});
