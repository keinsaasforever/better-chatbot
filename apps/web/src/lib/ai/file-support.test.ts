import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILE_PART_MIME_TYPES,
  isFilePartSupported,
  isIngestSupported,
} from "./file-support";

describe("file-support", () => {
  it("returns false when mime is missing", () => {
    expect(isFilePartSupported(undefined)).toBe(false);
  });

  it("returns true for default supported image types", () => {
    expect(isFilePartSupported("image/jpeg")).toBe(true);
    expect(isFilePartSupported("image/png")).toBe(true);
    expect(isFilePartSupported("image/webp")).toBe(true);
    expect(isFilePartSupported("image/gif")).toBe(true);
  });

  it("treats pdf as ingest-supported rather than a default file part", () => {
    // PDFs are handled via server-side text extraction, not as inline file parts.
    expect(isFilePartSupported("application/pdf")).toBe(false);
    expect(isIngestSupported("application/pdf")).toBe(true);
  });

  it("returns false for unsupported mime types by default", () => {
    expect(isFilePartSupported("text/plain")).toBe(false);
    expect(isFilePartSupported("application/vnd.ms-excel")).toBe(false);
  });

  it("respects an explicitly provided mime whitelist", () => {
    const whitelist = ["application/pdf"];
    expect(isFilePartSupported("application/pdf", whitelist)).toBe(true);
    expect(isFilePartSupported("image/png", whitelist)).toBe(false);
  });

  it("treats an empty whitelist as no support", () => {
    expect(isFilePartSupported("image/png", [])).toBe(false);
  });

  it("exposes the default mime types constant", () => {
    expect(DEFAULT_FILE_PART_MIME_TYPES).toContain("image/jpeg");
    // PDF is intentionally excluded from inline file parts.
    expect(DEFAULT_FILE_PART_MIME_TYPES).not.toContain("application/pdf");
  });
});
