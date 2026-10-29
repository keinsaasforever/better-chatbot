import { afterEach, describe, expect, test } from "vitest";
import {
  INGEST_FORMATS,
  INGEST_SUPPORTED_MIME,
  INGESTED_MEDIA_TYPE,
  SUMMARIZE_SUPPORTED_MIME,
  formatForAttachment,
  isFormatEnabled,
} from "./formats";

/**
 * The point of the registry is that the derived values cannot drift from the
 * table. These assert the derivation rather than restating the lists, so a
 * format added to the table is automatically covered everywhere it matters.
 */

const attachment = (over: Record<string, unknown> = {}) =>
  ({ type: "source-url", url: "https://x/a", ...over }) as never;

afterEach(() => {
  delete process.env.INGEST_DISABLED_FORMATS;
});

describe("the derived lists follow the table", () => {
  test("INGEST_SUPPORTED_MIME is exactly the ingested formats' mimes", () => {
    const expected = INGEST_FORMATS.filter((f) => f.ingest).flatMap(
      (f) => f.mimes,
    );
    expect([...INGEST_SUPPORTED_MIME].sort()).toEqual(expected.sort());
  });

  test("a recognised-but-not-ingested mime is absent from the ingest set", () => {
    // Every format in the table is read today, so this holds vacuously — it
    // exists for the next format, which is listed before it has a reader.
    for (const format of INGEST_FORMATS.filter((f) => !f.ingest)) {
      for (const mime of format.mimes) {
        expect(INGEST_SUPPORTED_MIME.has(mime)).toBe(false);
      }
    }
  });

  test("a mime the table does not list is never ingestable", () => {
    for (const mime of [
      "application/zip",
      "image/png",
      // The legacy binary formats are deliberately out: reading them needs a
      // dependency this app does not carry.
      "application/msword",
      "application/vnd.ms-powerpoint",
    ]) {
      expect(INGEST_SUPPORTED_MIME.has(mime)).toBe(false);
    }
  });

  test("INGESTED_MEDIA_TYPE matches every mime in the table, ingested or not", () => {
    for (const format of INGEST_FORMATS) {
      for (const mime of format.mimes) {
        expect(INGESTED_MEDIA_TYPE.test(mime)).toBe(true);
      }
    }
  });

  test("INGESTED_MEDIA_TYPE does not match an unrelated type", () => {
    for (const mime of ["image/png", "video/mp4", "application/zip"]) {
      expect(INGESTED_MEDIA_TYPE.test(mime)).toBe(false);
    }
  });

  test("Summarize is narrower than ingest, because its route is CSV-only", () => {
    expect([...SUMMARIZE_SUPPORTED_MIME]).toEqual([
      "text/csv",
      "application/csv",
    ]);
    expect(SUMMARIZE_SUPPORTED_MIME.has("application/pdf")).toBe(false);
  });

  test("format ids are unique and no mime is claimed twice", () => {
    const ids = INGEST_FORMATS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const mimes = INGEST_FORMATS.flatMap((f) => f.mimes);
    expect(new Set(mimes).size).toBe(mimes.length);
    const exts = INGEST_FORMATS.flatMap((f) => f.exts);
    expect(new Set(exts).size).toBe(exts.length);
  });
});

describe("formatForAttachment", () => {
  test("matches on the declared mime", () => {
    expect(
      formatForAttachment(attachment({ mediaType: "application/pdf" }), "k")
        ?.id,
    ).toBe("pdf");
    expect(
      formatForAttachment(attachment({ mediaType: "APPLICATION/PDF" }), "k")
        ?.id,
    ).toBe("pdf");
  });

  test("falls back to the filename extension", () => {
    expect(
      formatForAttachment(attachment({ filename: "Q3 report.XLSX" }), "k")?.id,
    ).toBe("xlsx");
  });

  test("falls back to the storage key when there is no filename", () => {
    expect(formatForAttachment(attachment(), "user/uuid-deck.pptx")?.id).toBe(
      "pptx",
    );
  });

  test("reads a contentType query parameter", () => {
    expect(
      formatForAttachment(
        attachment({ url: "https://x/a?contentType=text/csv" }),
        "k",
      )?.id,
    ).toBe("csv");
    expect(
      formatForAttachment(
        attachment({ url: "https://x/a?foo=1&content-type=application/pdf" }),
        "k",
      )?.id,
    ).toBe("pdf");
  });

  test("a query string in the key does not become the extension", () => {
    // `a.csv?x=1.pdf` is a CSV; naive extension parsing would call it a PDF.
    expect(formatForAttachment(attachment(), "user/a.csv?x=1.pdf")?.id).toBe(
      "csv",
    );
  });

  test("returns null for a format the app does not know", () => {
    expect(
      formatForAttachment(attachment({ filename: "archive.zip" }), "k"),
    ).toBeNull();
    expect(formatForAttachment(attachment(), "user/no-extension")).toBeNull();
  });

  test("every format in the table is reachable by mime and by extension", () => {
    for (const format of INGEST_FORMATS) {
      for (const mime of format.mimes) {
        expect(
          formatForAttachment(attachment({ mediaType: mime }), "k")?.id,
        ).toBe(format.id);
      }
      for (const ext of format.exts) {
        expect(
          formatForAttachment(attachment({ filename: `f.${ext}` }), "k")?.id,
        ).toBe(format.id);
      }
    }
  });
});

describe("isFormatEnabled", () => {
  test("everything is on by default", () => {
    for (const format of INGEST_FORMATS) {
      expect(isFormatEnabled(format.id)).toBe(true);
    }
  });

  test("a format can be switched off without touching the others", () => {
    process.env.INGEST_DISABLED_FORMATS = " PDF , docx ";
    expect(isFormatEnabled("pdf")).toBe(false);
    expect(isFormatEnabled("docx")).toBe(false);
    expect(isFormatEnabled("csv")).toBe(true);
  });

  test("is read per call, so a deploy-time value cannot be baked in", () => {
    expect(isFormatEnabled("csv")).toBe(true);
    process.env.INGEST_DISABLED_FORMATS = "csv";
    expect(isFormatEnabled("csv")).toBe(false);
  });
});
