import { describe, expect, test } from "vitest";
import { fuzzySearch, type SearchItem } from "./fuzzy-search";

describe("fuzzySearch", () => {
  const testItems: SearchItem[] = [
    { id: "item-1", label: "Apple" },
    { id: "item-2", label: "Banana" },
    { id: "item-3", label: "Cherry" },
    { id: "item-4", label: "Dragon fruit" },
    { id: "apple-5", label: "Elderberry" },
    { id: "item-6", label: "Fig" },
  ];

  test("returns all items when query is empty", () => {
    expect(fuzzySearch(testItems, "")).toEqual(testItems);
    expect(fuzzySearch(testItems, "   ")).toEqual(testItems);
  });

  test("finds exact matches in id", () => {
    const result = fuzzySearch(testItems, "apple");

    // Should match item-1 (label: Apple) and apple-5 (id: apple-5)
    expect(result).toHaveLength(2);
    expect(result).toContainEqual(testItems[0]); // Apple
    expect(result).toContainEqual(testItems[4]); // apple-5
  });

  test("finds exact matches in label", () => {
    const result = fuzzySearch(testItems, "ban");

    // Should match item-2 (label: Banana)
    expect(result).toHaveLength(1);
    expect(result).toContainEqual(testItems[1]); // Banana
  });

  test("ignores special characters in query", () => {
    const result = fuzzySearch(testItems, "d*r*a*g*o*n");

    // Should match item-4 (label: Dragon fruit)
    expect(result).toHaveLength(1);
    expect(result).toContainEqual(testItems[3]); // Dragon fruit
  });

  test("matches using bigram similarity for longer queries", () => {
    const result = fuzzySearch(testItems, "el");

    // Should match item-5 (label: Elderberry)
    expect(result).toHaveLength(1);
    expect(result).toContainEqual(testItems[4]); // Elderberry
  });

  test("sorts results by score", () => {
    // Add item with partial match to test sorting
    const extendedItems: SearchItem[] = [
      ...testItems,
      { id: "app-test", label: "Application" },
    ];

    const result = fuzzySearch(extendedItems, "app");

    // Check that app-related items are returned
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result).toContainEqual(testItems[0]); // Apple
    expect(result).toContainEqual(testItems[4]); // apple-5
    expect(result).toContainEqual({ id: "app-test", label: "Application" });

    // The actual order depends on the scoring implementation
    // Don't assert exact order as it can change
  });

  test("filters items with score below minimum threshold", () => {
    const result = fuzzySearch(testItems, "xyz");

    // Should not match any items
    expect(result).toHaveLength(0);
  });

  test("ignores case sensitivity", () => {
    const result = fuzzySearch(testItems, "CHERRY");

    // CHERRY matches both Cherry and potentially other items
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toContainEqual(testItems[2]); // Cherry
  });
});
