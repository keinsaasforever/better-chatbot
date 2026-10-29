import { JSONSchema7 } from "json-schema";

/**
 * Input contract for `create-pdf`.
 *
 * Kept apart from the tool itself so the placeholder in the static toolkit map
 * can describe the same shape without importing the E2B SDK and node:crypto
 * that the real implementation pulls in.
 */
export const createPdfSchema: JSONSchema7 = {
  type: "object",
  properties: {
    filename: {
      type: "string",
      description:
        "File name for the PDF, ending in .pdf (e.g. 'offer-acme.pdf'). This is what the user sees and downloads.",
    },
    html: {
      type: "string",
      description: `A complete, self-contained HTML document to render. Rules that matter:
- Inline everything. All CSS must be in a <style> block; there is no network access during rendering, so external stylesheets, webfonts and remote <img> sources will silently not load. Embed images as data: URIs.
- Use @page for margins and page size, e.g. @page { size: A4; margin: 2cm; }.
- Page breaks are controlled with page-break-before/page-break-after/page-break-inside.
- Available fonts are DejaVu and Liberation. Set a real fallback stack (e.g. font-family: 'Liberation Sans', 'DejaVu Sans', sans-serif).
- The renderer is WeasyPrint: it implements print CSS well (tables, floats, flexbox, counters) but runs no JavaScript. Do not rely on scripts, and do not use a charting library — pass a chart in as an embedded image if you need one.`,
    },
    title: {
      type: "string",
      description: "Document title, written into the PDF metadata.",
    },
  },
  required: ["filename", "html"],
};
