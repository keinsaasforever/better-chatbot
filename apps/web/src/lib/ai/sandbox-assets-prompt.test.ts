import { describe, expect, it } from "vitest";
import { buildSandboxAssetsSystemPrompt } from "./prompts";

describe("buildSandboxAssetsSystemPrompt", () => {
  it("is empty when the turn has no attachments", () => {
    // Must contribute nothing to the prompt, otherwise every turn without an
    // upload pays for the block and invalidates the cached prefix.
    expect(buildSandboxAssetsSystemPrompt([])).toBe("");
  });

  it("lists each asset URL and forbids base64", () => {
    const prompt = buildSandboxAssetsSystemPrompt([
      {
        url: "https://example.supabase.co/storage/v1/object/public/attachments/u/1-wall.png",
        filename: "wall.png",
        mediaType: "image/png",
      },
      {
        url: "https://example.supabase.co/storage/v1/object/public/attachments/u/2-street.png",
        filename: "street.png",
        mediaType: "image/png",
      },
    ]);

    expect(prompt).toContain("1-wall.png");
    expect(prompt).toContain("2-street.png");
    expect(prompt).toContain("wall.png (image/png)");
    expect(prompt).toContain("base64");
    expect(prompt).toContain("<uploaded_file_urls>");
  });

  it("falls back to a positional name when the filename is missing", () => {
    const prompt = buildSandboxAssetsSystemPrompt([
      { url: "https://example.com/a.png" },
      { url: "https://example.com/b.png", filename: "   " },
    ]);

    expect(prompt).toContain("attachment-1");
    expect(prompt).toContain("attachment-2");
  });
});
