import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/pg/db.pg", () => ({ pgDb: {} }));

const { rankWhoKnows } = await import("./graph-query");

const person = (id: string, salience = 0) => ({
  id,
  type: "person",
  title: id,
  summary: null,
  salience,
});

const link = (from: string, to: string, confidence = 1) => ({
  id: `${from}-${to}`,
  fromPageId: from,
  toPageId: to,
  linkType: "related_to" as const,
  confidence,
  context: null,
});

describe("rankWhoKnows", () => {
  it("ranks people by weighted links into the target pages, salience as tie-break", () => {
    const ranked = rankWhoKnows({
      people: [person("alex", 1), person("clara", 5), person("nobody", 9)],
      targetIds: new Set(["moebel", "board"]),
      links: [
        link("alex", "moebel"),
        link("alex", "board", 0.5),
        link("moebel", "clara"),
        link("clara", "unrelated"),
      ],
    });

    expect(ranked.map((row) => row.person.id)).toEqual(["alex", "clara"]);
    expect(ranked[0].score).toBe(1.5);
  });

  it("breaks equal scores by salience", () => {
    const ranked = rankWhoKnows({
      people: [person("low", 1), person("high", 3)],
      targetIds: new Set(["t"]),
      links: [link("low", "t"), link("high", "t")],
    });

    expect(ranked.map((row) => row.person.id)).toEqual(["high", "low"]);
  });
});
