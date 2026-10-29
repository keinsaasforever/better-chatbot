import { describe, expect, it } from "vitest";
import {
  EDGE_TYPE_DESCRIPTIONS,
  PROJECT_EDGE_TYPES,
  isProjectEdgeType,
  normalizeEdgeType,
} from "./edge-types";

describe("normalizeEdgeType", () => {
  it("keeps known types and normalises casing and separators", () => {
    expect(normalizeEdgeType("works_at")).toBe("works_at");
    expect(normalizeEdgeType("Works-At")).toBe("works_at");
    expect(normalizeEdgeType(" blocked by ")).toBe("blocked_by");
  });

  it("maps common synonyms onto the vocabulary", () => {
    expect(normalizeEdgeType("attended-by")).toBe("attended");
    expect(normalizeEdgeType("employed_by")).toBe("works_at");
    expect(normalizeEdgeType("assigned_to")).toBe("responsible_for");
    expect(normalizeEdgeType("mentioned_in")).toBe("discussed_in");
  });

  it("falls back to related_to for unknown, empty or null input", () => {
    expect(normalizeEdgeType("sings_with")).toBe("related_to");
    expect(normalizeEdgeType("")).toBe("related_to");
    expect(normalizeEdgeType(null)).toBe("related_to");
  });
});

describe("vocabulary", () => {
  it("has a description for every edge type", () => {
    for (const type of PROJECT_EDGE_TYPES) {
      expect(EDGE_TYPE_DESCRIPTIONS[type]).toBeTruthy();
      expect(isProjectEdgeType(type)).toBe(true);
    }
    expect(isProjectEdgeType("nope")).toBe(false);
  });
});
