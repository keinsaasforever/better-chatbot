import { describe, expect, it } from "vitest";
import {
  CSV_MIME,
  DOCX_MIME,
  PPTX_MIME,
  XLSX_MIME,
  artifactPreviewType,
  artifactStorageKey,
  attachmentToArtifactFile,
  canPreviewInPanel,
  inlinePreviewUrl,
  previewKindForFile,
  splitArtifactsForPanel,
} from "./artifact-media";

const URL_BASE = "https://sb.co/storage/v1/object/public/ai-generated/u";
/** Where TUS writes an upload: the attachments bucket, under the owner's id. */
const UPLOAD_BASE = "https://sb.co/storage/v1/object/public/attachments";
const STORED = "/api/storage/download?key=user_1%2Fuuid-report.pdf";
const STORED_SHEET = "/api/storage/download?key=user_1%2Fuuid-book.xlsx";

describe("splitArtifactsForPanel", () => {
  it("opens a PDF that reached storage in the panel", () => {
    const { files, downloads } = splitArtifactsForPanel([
      { filename: "report.pdf", mimeType: "application/pdf", url: STORED },
    ]);

    expect(files).toEqual([
      {
        filename: "report.pdf",
        url: STORED,
        previewUrl: `${STORED}&disposition=inline`,
        mimeType: "application/pdf",
        sizeBytes: undefined,
      },
    ]);
    // Not listed twice — the panel carries its own download control.
    expect(downloads).toEqual([]);
  });

  it("keeps the size the collector measured", () => {
    const { files } = splitArtifactsForPanel([
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        url: STORED,
        sizeBytes: 1234,
      },
    ]);

    expect(files[0]?.sizeBytes).toBe(1234);
  });

  it("keeps a PDF that only has base64 as a download card", () => {
    // The upload failed, so there is no URL for an iframe to point at.
    const { files, downloads } = splitArtifactsForPanel([
      {
        filename: "report.pdf",
        mimeType: "application/pdf",
        contentBase64: "x",
      },
    ]);

    expect(files).toEqual([]);
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.href).toBe("data:application/pdf;base64,x");
    expect(downloads[0]?.unavailable).toBe(false);
  });

  it("opens images too", () => {
    const { files } = splitArtifactsForPanel([
      {
        filename: "chart.png",
        mimeType: "image/png",
        url: `${URL_BASE}/c.png`,
      },
    ]);

    expect(files[0]?.mimeType).toBe("image/png");
    // A foreign URL is already renderable; nothing to rewrite.
    expect(files[0]?.previewUrl).toBe(`${URL_BASE}/c.png`);
  });

  it("opens a stored spreadsheet in the panel, with no inline URL", () => {
    const { files, downloads } = splitArtifactsForPanel([
      {
        filename: "book.xlsx",
        mimeType: XLSX_MIME,
        url: STORED_SHEET,
        sizeBytes: 4096,
      },
    ]);

    expect(files).toEqual([
      {
        filename: "book.xlsx",
        url: STORED_SHEET,
        // The panel reads it through the sheet route; an inline disposition
        // would be a no-op, since the download route's allowlist excludes it.
        previewUrl: undefined,
        mimeType: XLSX_MIME,
        sizeBytes: 4096,
      },
    ]);
    expect(downloads).toEqual([]);
  });

  it("lists a data file as a download card, never in the panel", () => {
    const { files, downloads } = splitArtifactsForPanel([
      { filename: "data.csv", mimeType: "text/csv", url: `${URL_BASE}/d.csv` },
      {
        filename: "book.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        url: `${URL_BASE}/b.xlsx`,
        sizeBytes: 5_000_000,
      },
    ]);

    // CSV has no viewer, and this xlsx is on a foreign URL, so the sheet
    // route has no storage key to parse it by. Both stay download cards.
    expect(files).toEqual([]);
    expect(downloads.map((d) => d.filename)).toEqual(["data.csv", "book.xlsx"]);
    expect(downloads.every((d) => d.href && !d.unavailable)).toBe(true);
    expect(downloads[1]?.sizeBytes).toBe(5_000_000);
  });

  it("names a file that could not be delivered, without a download", () => {
    const { files, downloads } = splitArtifactsForPanel([
      { filename: "huge.xlsx", sizeBytes: 60_000_000, error: "file too large" },
    ]);

    expect(files).toEqual([]);
    expect(downloads).toEqual([
      {
        filename: "huge.xlsx",
        mimeType: undefined,
        sizeBytes: 60_000_000,
        href: undefined,
        unavailable: true,
      },
    ]);
  });

  it("falls back to the extension when the mime type is missing", () => {
    const { files } = splitArtifactsForPanel([
      { filename: "REPORT.PDF", url: `${URL_BASE}/r.pdf` },
      { filename: "shot.JPEG", url: `${URL_BASE}/s.jpeg` },
    ]);

    // The filename decides, not the kind: several formats share a kind now, so
    // guessing one mime per kind would mislabel the rest.
    expect(files.map((f) => f.mimeType)).toEqual([
      "application/pdf",
      "image/jpeg",
    ]);
  });

  it("drops an artifact with neither a url, bytes nor a reason", () => {
    const { files, downloads } = splitArtifactsForPanel([
      { filename: "ghost.pdf", mimeType: "application/pdf" },
    ]);

    expect(files).toEqual([]);
    expect(downloads).toEqual([]);
  });
});

describe("artifactPreviewType", () => {
  it("refuses SVG, which the storage route will not serve inline", () => {
    expect(
      artifactPreviewType({ filename: "d.svg", mimeType: "image/svg+xml" }),
    ).toBeUndefined();
    expect(artifactPreviewType({ filename: "d.svg" })).toBeUndefined();
  });

  it("recognises a spreadsheet by mime or extension", () => {
    expect(
      artifactPreviewType({
        filename: "b.xlsx",
        mimeType: XLSX_MIME,
        url: STORED_SHEET,
      }),
    ).toBe("sheet");
    expect(artifactPreviewType({ filename: "b.xlsx", url: STORED_SHEET })).toBe(
      "sheet",
    );
  });

  it("only previews a spreadsheet the sheet route can reach", () => {
    // No storage key to parse by: a foreign URL, and bytes with no URL at all.
    expect(
      artifactPreviewType({
        filename: "b.xlsx",
        mimeType: XLSX_MIME,
        url: `${URL_BASE}/b.xlsx`,
      }),
    ).toBeUndefined();
    expect(
      artifactPreviewType({ filename: "b.xlsx", contentBase64: "AA==" }),
    ).toBeUndefined();
    // exceljs cannot open the old binary format.
    expect(
      artifactPreviewType({ filename: "b.xls", url: STORED_SHEET }),
    ).toBeUndefined();
  });
});

describe("previewKindForFile", () => {
  it("names the kind the panel renders each mime as", () => {
    const kindOf = (mimeType: string) => previewKindForFile({ mimeType });

    expect(kindOf("application/pdf")).toBe("pdf");
    expect(kindOf("image/png")).toBe("image");
    expect(kindOf(XLSX_MIME)).toBe("sheet");
    expect(kindOf(CSV_MIME)).toBe("csv");
    expect(kindOf(DOCX_MIME)).toBe("document");
    expect(kindOf(PPTX_MIME)).toBe("slides");
    expect(kindOf("text/markdown")).toBe("text");
    expect(kindOf("application/zip")).toBeUndefined();
  });

  it("refuses SVG, which the storage route will not serve inline", () => {
    expect(previewKindForFile({ mimeType: "image/svg+xml" })).toBeUndefined();
  });
});

describe("canPreviewInPanel", () => {
  it("is true for a PDF or an image with something to point a frame at", () => {
    expect(
      canPreviewInPanel({ mimeType: "application/pdf", previewUrl: "/x" }),
    ).toBe(true);
    expect(canPreviewInPanel({ mimeType: "image/png", previewUrl: "/x" })).toBe(
      true,
    );
  });

  it("is false without the URL an iframe would need", () => {
    // The upload failed, so there is nothing to point the frame at.
    expect(canPreviewInPanel({ mimeType: "application/pdf" })).toBe(false);
  });

  it("is true for a server-rendered kind on our own download route", () => {
    // These need no preview URL — the route parses them by storage key — but
    // they do need a key, which only the app's own download URL carries.
    for (const mimeType of [XLSX_MIME, CSV_MIME, DOCX_MIME, PPTX_MIME]) {
      expect(canPreviewInPanel({ mimeType, url: STORED_SHEET })).toBe(true);
      expect(canPreviewInPanel({ mimeType, url: `${URL_BASE}/x` })).toBe(false);
      expect(canPreviewInPanel({ mimeType })).toBe(false);
    }
  });

  it("is false for a type with no viewer at all", () => {
    expect(
      canPreviewInPanel({ mimeType: "application/zip", url: STORED_SHEET }),
    ).toBe(false);
  });
});

describe("attachmentToArtifactFile", () => {
  it("routes an upload's download through the app route", () => {
    // The persisted URL is a public-shaped bucket link, against a bucket the
    // storage layer treats as private and which the desktop shell hands to the
    // system browser. The app route is owner-checked and never expires.
    expect(
      attachmentToArtifactFile({
        url: `${UPLOAD_BASE}/user_1/uuid-report.pdf`,
        filename: "report.pdf",
        mediaType: "application/pdf",
      }),
    ).toEqual({
      filename: "report.pdf",
      url: "/api/storage/download?key=user_1%2Fuuid-report.pdf",
      previewUrl:
        "/api/storage/download?key=user_1%2Fuuid-report.pdf&disposition=inline",
      mimeType: "application/pdf",
    });
  });

  it("accepts a URL that is already the app route", () => {
    const file = attachmentToArtifactFile({
      url: "/api/storage/download?key=user_1%2Fuuid-book.xlsx",
      filename: "book.xlsx",
      mediaType: XLSX_MIME,
    });

    expect(file?.url).toBe("/api/storage/download?key=user_1%2Fuuid-book.xlsx");
    // The panel reads a workbook through the sheet route, so an inline
    // disposition would be a no-op — the download route's allowlist excludes it.
    expect(file?.previewUrl).toBeUndefined();
  });

  it("derives what the upload did not carry", () => {
    const file = attachmentToArtifactFile({
      url: `${UPLOAD_BASE}/user_1/uuid-notes.docx`,
      mediaType: "application/octet-stream",
    });

    expect(file?.filename).toBe("uuid-notes.docx");
    expect(file?.mimeType).toBe(DOCX_MIME);
  });

  it("returns null for anything that is not one of our storage objects", () => {
    // Left on the plain card: nothing here can be fetched, previewed or
    // vouched for, and the download route would refuse all of them anyway.
    expect(
      attachmentToArtifactFile({ url: "https://example.test/a/secret.pdf" }),
    ).toBeNull();
    expect(
      attachmentToArtifactFile({ url: "data:application/pdf;base64,AAAA" }),
    ).toBeNull();
    // A different bucket is not an attachment.
    expect(
      attachmentToArtifactFile({ url: `${URL_BASE}/generated.pdf` }),
    ).toBeNull();
    expect(attachmentToArtifactFile({})).toBeNull();
  });
});

describe("artifactStorageKey", () => {
  it("decodes the key from an app download URL", () => {
    expect(artifactStorageKey(STORED_SHEET)).toBe("user_1/uuid-book.xlsx");
  });

  it("returns null for anything the app does not serve", () => {
    expect(artifactStorageKey(`${URL_BASE}/b.xlsx`)).toBeNull();
    expect(artifactStorageKey("data:text/csv;base64,AA==")).toBeNull();
    expect(artifactStorageKey(undefined)).toBeNull();
  });
});

describe("inlinePreviewUrl", () => {
  it("adds the param to a storage download URL", () => {
    expect(inlinePreviewUrl("/api/storage/download?key=a%2Fb.pdf")).toBe(
      "/api/storage/download?key=a%2Fb.pdf&disposition=inline",
    );
  });

  it("leaves foreign URLs alone", () => {
    // Appending a param to a signed URL can invalidate its signature.
    const signed = `${URL_BASE}/r.pdf?token=abc`;
    expect(inlinePreviewUrl(signed)).toBe(signed);
    expect(inlinePreviewUrl("data:application/pdf;base64,AAAA")).toBe(
      "data:application/pdf;base64,AAAA",
    );
  });

  it("is idempotent", () => {
    const once = inlinePreviewUrl("/api/storage/download?key=a");
    expect(inlinePreviewUrl(once)).toBe(once);
  });
});
