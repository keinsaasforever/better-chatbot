import { describe, expect, it } from "vitest";
import { buildToolCatalog } from "./tool-catalog";

describe("buildToolCatalog", () => {
  it("maps slugs with normalized, truncated descriptions", () => {
    const catalog = buildToolCatalog({
      GMAIL_FETCH_EMAILS: {
        description: `Fetch   emails\nwith filters. ${"x".repeat(300)}`,
      },
      GMAIL_LIST_LABELS: {},
    });

    expect(catalog).toHaveLength(2);
    expect(catalog[0].slug).toBe("GMAIL_FETCH_EMAILS");
    expect(
      catalog[0].description.startsWith("Fetch emails with filters."),
    ).toBe(true);
    expect(catalog[0].description.length).toBeLessThanOrEqual(200);
    expect(catalog[1].description).toBe("");
  });

  it("caps the catalog at 40 actions", () => {
    const tools = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [
        `ACTION_${index}`,
        { description: "d" },
      ]),
    );
    expect(buildToolCatalog(tools)).toHaveLength(40);
  });
});
