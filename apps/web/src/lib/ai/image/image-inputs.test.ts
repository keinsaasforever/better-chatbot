import { describe, expect, it } from "vitest";
import {
  extractLatestUserText,
  isAllowedImageSourceUrl,
  sanitizeImagePrompt,
} from "./image-inputs";

describe("isAllowedImageSourceUrl", () => {
  const storage = "https://abc.supabase.co";

  it("accepts only the storage origin when one is configured", () => {
    expect(
      isAllowedImageSourceUrl(
        "https://abc.supabase.co/storage/v1/object/public/attachments/u/a.png",
        storage,
      ),
    ).toBe(true);
    expect(isAllowedImageSourceUrl("https://evil.example/a.png", storage)).toBe(
      false,
    );
    expect(
      isAllowedImageSourceUrl(
        "https://abc.supabase.co.evil.example/a.png",
        storage,
      ),
    ).toBe(false);
  });

  it("rejects non-https and non-URL input", () => {
    expect(
      isAllowedImageSourceUrl("http://abc.supabase.co/a.png", storage),
    ).toBe(false);
    expect(isAllowedImageSourceUrl("not a url", storage)).toBe(false);
    expect(isAllowedImageSourceUrl("data:image/png;base64,AAAA", storage)).toBe(
      false,
    );
  });

  it("falls back to any https origin without a configured storage URL", () => {
    expect(isAllowedImageSourceUrl("https://cdn.example/a.png")).toBe(true);
    expect(isAllowedImageSourceUrl("http://cdn.example/a.png")).toBe(false);
  });

  it("allows a local http storage origin when that is what is configured", () => {
    expect(
      isAllowedImageSourceUrl(
        "http://127.0.0.1:54321/storage/v1/object/public/attachments/a.png",
        "http://127.0.0.1:54321",
      ),
    ).toBe(true);
  });
});

describe("sanitizeImagePrompt", () => {
  it("drops the attachment list, the ingestion blocks and any URL", () => {
    const raw = [
      "Attached files:",
      "1. ChatGPT Image Sep 18, 2026, 02_20_31 PM.png (image/png)",
      "The <attachment> blocks below are the contents of files the user attached.",
      '<attachment index="1" name="notes.csv" kind="sheet" partial="false">',
      "a,b,c",
      "</attachment>",
      "where the mask is, add in white font: Proudly built in the EU with an EU flag",
      "https://abc.supabase.co/storage/v1/object/public/attachments/u/a.png",
    ].join("\n");

    expect(sanitizeImagePrompt(raw)).toBe(
      "where the mask is, add in white font: Proudly built in the EU with an EU flag",
    );
  });

  it("keeps a plain instruction untouched", () => {
    expect(sanitizeImagePrompt("  a red bicycle  ")).toBe("a red bicycle");
  });

  it("caps a runaway prompt", () => {
    expect(sanitizeImagePrompt("x".repeat(5000)).length).toBe(600);
  });
});

describe("extractLatestUserText", () => {
  it("returns the newest user turn with the app's additions removed", () => {
    expect(
      extractLatestUserText([
        { role: "user", content: "an old request" },
        { role: "assistant", content: "done" },
        {
          role: "user",
          content: [
            { type: "text", text: "Attached files:\n1. photo.png (image/png)" },
            { type: "text", text: "make the sky orange" },
          ],
        },
      ]),
    ).toBe("make the sky orange");
  });

  it("falls back to an older turn when the newest has nothing left", () => {
    expect(
      extractLatestUserText([
        { role: "user", content: "make the sky orange" },
        { role: "user", content: "https://abc.supabase.co/a.png" },
      ]),
    ).toBe("make the sky orange");
  });
});
