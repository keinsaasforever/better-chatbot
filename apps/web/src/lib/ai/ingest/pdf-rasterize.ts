import { Buffer } from "node:buffer";
import globalLogger from "logger";

const logger = globalLogger.withDefaults({ message: "PDF rasterize: " });

export type RasterizedPage = {
  pageNumber: number;
  /** PNG bytes, base64-encoded. */
  base64: string;
  mediaType: "image/png";
};

/**
 * How many pages of one PDF are rendered for the model.
 *
 * Every page is an image, and an image costs far more than the same page of
 * extracted text, so this is the main cost lever. Five covers the documents
 * this exists for (a form, a letterhead, a one-page invoice) without turning a
 * 200-page report into a five-figure token bill.
 */
export const DEFAULT_MAX_RASTER_PAGES = 5;

/**
 * Long edge of a rendered page, in pixels.
 *
 * Vision models downscale beyond roughly 1.5k px, so rendering larger costs
 * bytes and wall-clock without adding anything the model can see. Below about
 * 1k px, body text stops being legible.
 */
const TARGET_LONG_EDGE_PX = 1400;

/** A page bigger than this is dropped rather than sent; something went wrong. */
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

export function maxRasterPages(): number {
  const configured = Number.parseInt(
    process.env.PDF_VISION_MAX_PAGES ?? "",
    10,
  );
  if (!Number.isFinite(configured) || configured < 0) {
    return DEFAULT_MAX_RASTER_PAGES;
  }
  return configured;
}

/**
 * Render the first pages of a PDF as PNG images.
 *
 * Text extraction gives the model the words but throws away the document:
 * where things sit, what is a heading, which cells belong to which column,
 * what the thing looks like. Asking a model to reproduce a layout it has only
 * read the words of does not work. Rendering the page and handing over the
 * pixels is what makes "rebuild this document" a solvable problem, and it is
 * the only thing that works at all for a scanned PDF, where extraction returns
 * nothing.
 *
 * Best-effort throughout: a failure here must never fail the chat turn. The
 * caller still has the extracted text, which is the fallback.
 */
export async function rasterizePdfPages(
  content: Buffer,
  options: { maxPages?: number } = {},
): Promise<RasterizedPage[]> {
  const maxPages = options.maxPages ?? maxRasterPages();
  if (maxPages <= 0) return [];

  try {
    // Imported lazily: this pulls in pdf.js and a native canvas binding, and
    // most chat turns have no PDF attached.
    const { getDocumentProxy, renderPageAsImage } = await import("unpdf");

    // `getDocumentProxy` takes ownership of the buffer it is given, so each
    // call below gets its own copy. Sharing one leaves the second reader
    // looking at a detached ArrayBuffer.
    const probe = await getDocumentProxy(toUint8(content));
    const pageCount = Math.min(probe.numPages, maxPages);

    const pages: RasterizedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      try {
        const scale = await scaleForPage(probe, pageNumber);
        const png = await renderPageAsImage(toUint8(content), pageNumber, {
          scale,
          canvasImport: () => import("@napi-rs/canvas"),
        });
        const bytes = Buffer.from(png);
        if (bytes.byteLength > MAX_PAGE_BYTES) {
          logger.warn(
            `page ${pageNumber} skipped, ${bytes.byteLength} bytes exceeds the cap`,
          );
          continue;
        }
        pages.push({
          pageNumber,
          base64: bytes.toString("base64"),
          mediaType: "image/png",
        });
      } catch (error) {
        // One bad page should not cost the rest of the document.
        logger.warn(`page ${pageNumber} failed to render: ${describe(error)}`);
      }
    }

    return pages;
  } catch (error) {
    logger.warn(`rasterization unavailable: ${describe(error)}`);
    return [];
  }
}

/**
 * Scale that puts the page's long edge near the target width.
 *
 * A fixed scale would render an A4 page and a slide deck at wildly different
 * effective resolutions, so one of them is always wrong.
 */
async function scaleForPage(
  doc: { getPage: (n: number) => Promise<any> },
  pageNumber: number,
): Promise<number> {
  try {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const longEdge = Math.max(viewport.width, viewport.height);
    if (!longEdge || !Number.isFinite(longEdge)) return 2;
    // Never upscale past 3x: a tiny page rendered huge is just blur.
    return Math.min(3, Math.max(1, TARGET_LONG_EDGE_PX / longEdge));
  } catch {
    return 2;
  }
}

/** A standalone copy, so pdf.js taking ownership cannot detach a shared one. */
function toUint8(content: Buffer): Uint8Array {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return copy;
}

function describe(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}
