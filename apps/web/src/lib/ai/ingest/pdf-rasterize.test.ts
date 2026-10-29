import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("logger", () => ({
  default: {
    withDefaults: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  },
}));

import {
  DEFAULT_MAX_RASTER_PAGES,
  maxRasterPages,
  rasterizePdfPages,
} from "./pdf-rasterize";

/**
 * A one-page PDF with a line of real text, written by hand.
 *
 * A fixture file would be a binary blob nobody can review; this is legible and
 * the renderer treats it exactly like any other PDF.
 */
function onePagePdf(text = "RASTER OK"): Buffer {
  const stream = `BT /F1 24 Tf 30 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

const originalMaxPages = process.env.PDF_VISION_MAX_PAGES;
afterEach(() => {
  if (originalMaxPages === undefined) delete process.env.PDF_VISION_MAX_PAGES;
  else process.env.PDF_VISION_MAX_PAGES = originalMaxPages;
});

describe("rasterizePdfPages", () => {
  it("renders a page to a real PNG", async () => {
    const pages = await rasterizePdfPages(onePagePdf(), { maxPages: 1 });

    expect(pages).toHaveLength(1);
    expect(pages[0]?.pageNumber).toBe(1);
    expect(pages[0]?.mediaType).toBe("image/png");

    // Assert on the bytes, not just a truthy string: a stub that returned ""
    // would otherwise pass and the model would silently get nothing.
    const bytes = Buffer.from(pages[0]!.base64, "base64");
    expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(bytes.byteLength).toBeGreaterThan(1000);
  }, 30_000);

  it("renders nothing when the page budget is zero", async () => {
    // The kill switch: PDF_VISION_MAX_PAGES=0 falls back to text alone.
    expect(await rasterizePdfPages(onePagePdf(), { maxPages: 0 })).toEqual([]);
  });

  it("returns nothing rather than throwing on a corrupt file", async () => {
    // Rendering is best-effort — a failure here must not fail the chat turn.
    const pages = await rasterizePdfPages(Buffer.from("not a pdf at all"));
    expect(pages).toEqual([]);
  }, 30_000);
});

describe("maxRasterPages", () => {
  it("defaults when unset or nonsense", () => {
    delete process.env.PDF_VISION_MAX_PAGES;
    expect(maxRasterPages()).toBe(DEFAULT_MAX_RASTER_PAGES);

    process.env.PDF_VISION_MAX_PAGES = "not-a-number";
    expect(maxRasterPages()).toBe(DEFAULT_MAX_RASTER_PAGES);

    process.env.PDF_VISION_MAX_PAGES = "-3";
    expect(maxRasterPages()).toBe(DEFAULT_MAX_RASTER_PAGES);
  });

  it("honours an explicit budget, zero included", () => {
    process.env.PDF_VISION_MAX_PAGES = "2";
    expect(maxRasterPages()).toBe(2);

    process.env.PDF_VISION_MAX_PAGES = "0";
    expect(maxRasterPages()).toBe(0);
  });
});
