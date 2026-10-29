import { describe, expect, it } from "vitest";
import { buildPageSlug, isValidPageSlug } from "./slug";

describe("buildPageSlug", () => {
  it("keeps a readable prefix and appends a random suffix", () => {
    const slug = buildPageSlug("Navigator Launch Storyboard");
    expect(slug.startsWith("navigator-launch-storyboard-")).toBe(true);
    expect(isValidPageSlug(slug)).toBe(true);
  });

  it("never repeats a slug for the same title", () => {
    // The slug is the whole access control, so collisions would hand one
    // user's page to another.
    const slugs = new Set(
      Array.from({ length: 200 }, () => buildPageSlug("Same Title")),
    );
    expect(slugs.size).toBe(200);
  });

  it("survives titles with no usable characters", () => {
    const slug = buildPageSlug("!!! ***");
    expect(slug.startsWith("page-")).toBe(true);
    expect(isValidPageSlug(slug)).toBe(true);
  });

  it("strips accents rather than dropping the letter", () => {
    expect(buildPageSlug("Störyboard").startsWith("storyboard-")).toBe(true);
  });

  it("bounds the prefix and leaves no trailing dash before the suffix", () => {
    const slug = buildPageSlug("a".repeat(200));
    expect(isValidPageSlug(slug)).toBe(true);
    expect(slug).not.toContain("--");
  });
});

describe("isValidPageSlug", () => {
  it("rejects slugs without a full-length random suffix", () => {
    expect(isValidPageSlug("storyboard")).toBe(false);
    expect(isValidPageSlug("storyboard-abc")).toBe(false);
    expect(isValidPageSlug(`storyboard-${"a".repeat(23)}`)).toBe(false);
  });

  it("rejects traversal and injection shapes", () => {
    expect(isValidPageSlug("../../etc/passwd")).toBe(false);
    expect(isValidPageSlug(`a-${"0".repeat(24)}/..`)).toBe(false);
    expect(isValidPageSlug(`A-${"0".repeat(24)}`)).toBe(false);
    expect(isValidPageSlug("")).toBe(false);
  });
});
