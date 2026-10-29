import { randomUUID } from "node:crypto";
import { type Tool, tool as createTool } from "ai";
import type { E2BArtifact } from "lib/code-runner/code-runner.interface";
import { persistArtifacts } from "lib/code-runner/e2b-run";
import {
  type SandboxBillingContext,
  createSandbox,
  errorLabel,
  toSandboxErrorResponse,
} from "lib/e2b/create-sandbox";
import { getExecutionTemplateId } from "lib/e2b/sandbox-registry";
import { sanitizeFilename } from "lib/file-storage/storage-utils";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import logger from "lib/logger";
import { createPdfSchema } from "./create-pdf-schema";

/** Matches the cap the model is told about in `create-pdf-schema.ts`. */
const MAX_HTML_BYTES = 2 * 1024 * 1024;

/** Rendering is a single WeasyPrint call; a slow one is a runaway one. */
const RENDER_TIMEOUT_MS = 90_000;

/** Long enough for a cold start plus the render, short enough to not linger. */
const SANDBOX_TIMEOUT_MS = 5 * 60_000;

const SANDBOX_WORKDIR = "/home/user";
const INPUT_FILENAME = "create-pdf-input.html";
const OUTPUT_FILENAME = "create-pdf-output.pdf";

export type CreatePdfContext = SandboxBillingContext;

/**
 * Renders an HTML document to a PDF the user can download.
 *
 * Why this exists next to `python-execution`: producing a document through the
 * code tool means the model writes layout code (reportlab flowables, manual
 * pagination) for what is really a formatting job, and every run pays a
 * sandbox cold start to re-derive the same page furniture. Here the model
 * writes HTML and CSS — which it is far better at — and the layout engine does
 * the rest.
 *
 * The HTML is written to a file and read back by a fixed script rather than
 * interpolated into the code string. That is not a style preference: HTML
 * carrying a `'''` or a backslash would otherwise break out of the literal and
 * change the program being run.
 *
 * Unlike the code tools this has a real `execute` and so runs inside the step
 * loop, in both interactive and headless turns: nothing about it needs a
 * browser, and the model can hand back the link in the same turn.
 */
export function createPdfTool(ctx: CreatePdfContext): Tool {
  return createTool({
    description: `Render a document as a PDF the user can download and open in the artifact panel.

Use this for a document whose content is prose and layout rather than computation: offers, quotes, reports, memos, letters, one-pagers, summaries. You write a complete HTML document with inline CSS; it comes back as a real PDF.

Prefer python-execution instead when the document's content has to be COMPUTED — numbers read from an attachment, a dataset aggregated, a chart rendered into the file.

Do not route document generation to external document or workbench integrations unless the user explicitly names one.`,
    inputSchema: jsonSchemaToZod(createPdfSchema),
    execute: async ({
      filename,
      html,
      title,
    }: {
      filename: string;
      html: string;
      title?: string;
    }) => {
      const safeName = ensurePdfName(filename);

      if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
        return {
          success: false,
          error: `The HTML document is larger than ${MAX_HTML_BYTES / 1024 / 1024}MB. Shorten it, or embed fewer/smaller images.`,
        };
      }

      const template = getExecutionTemplateId();
      const startedAt = Date.now();

      let sbx: Awaited<ReturnType<typeof createSandbox>>;
      try {
        sbx = await createSandbox(template, {
          timeoutMs: SANDBOX_TIMEOUT_MS,
          billing: ctx,
          requestId: randomUUID(),
        });
      } catch (err) {
        logger.error(`[create-pdf] sandbox create failed ${errorLabel(err)}`);
        return {
          success: false,
          error: toSandboxErrorResponse(err, template).message,
        };
      }

      try {
        const bytes = Buffer.from(html, "utf8");
        const buffer = new Uint8Array(bytes.byteLength);
        buffer.set(bytes);
        await sbx.files.write(
          `${SANDBOX_WORKDIR}/${INPUT_FILENAME}`,
          buffer.buffer,
        );

        const { error } = await sbx.runCode(renderScript(title), {
          language: "python",
          timeoutMs: RENDER_TIMEOUT_MS,
        });
        if (error) {
          logger.warn(
            `[create-pdf] render failed sbx=${sbx.sandboxId} error=${error.name}: ${String(
              error.value ?? "",
            ).slice(0, 500)}`,
          );
          return {
            success: false,
            error: `The document could not be rendered: ${error.name}: ${String(
              error.value ?? "",
            ).slice(0, 500)}`,
          };
        }

        const pdf = await sbx.files.read(
          `${SANDBOX_WORKDIR}/${OUTPUT_FILENAME}`,
          { format: "bytes" },
        );

        const artifact: E2BArtifact = {
          filename: safeName,
          mimeType: "application/pdf",
          contentBase64: Buffer.from(pdf).toString("base64"),
        };
        const [persisted] = await persistArtifacts([artifact], ctx.userId);

        logger.info(
          `[create-pdf] rendered file=${safeName} bytes=${pdf.byteLength} ms=${
            Date.now() - startedAt
          }`,
        );

        return {
          success: true,
          // The same shape the code tools return, so the artifact panel and
          // the model's own summary read it the same way either way.
          artifacts: [
            {
              filename: persisted.filename,
              mimeType: persisted.mimeType,
              url: persisted.url,
              sizeBytes: pdf.byteLength,
            },
          ],
          guide:
            "The PDF was delivered to the user as a download. Mention it briefly by filename; do not restate its contents.",
        };
      } catch (err) {
        logger.error(`[create-pdf] failed ${errorLabel(err)}`);
        return {
          success: false,
          error: `The document could not be produced: ${errorLabel(err)}`,
        };
      } finally {
        await sbx.kill().catch(() => {});
      }
    },
  });
}

/**
 * The renderer, as a fixed program. It reads the HTML from disk — see the note
 * on the tool above about why it is never interpolated into this string.
 */
function renderScript(title?: string): string {
  // Only the title reaches the source, and only as a JSON string literal,
  // which is a safe subset of Python's own string syntax.
  const titleLiteral = JSON.stringify(title ?? "");
  return [
    "from weasyprint import HTML",
    `html = open(${JSON.stringify(`${SANDBOX_WORKDIR}/${INPUT_FILENAME}`)}, encoding="utf-8").read()`,
    `title = ${titleLiteral}`,
    // base_url lets relative references resolve against the working directory
    // rather than being dropped outright.
    `doc = HTML(string=html, base_url=${JSON.stringify(SANDBOX_WORKDIR)}).render()`,
    "if title:",
    "    doc.metadata.title = title",
    `doc.write_pdf(${JSON.stringify(`${SANDBOX_WORKDIR}/${OUTPUT_FILENAME}`)})`,
  ].join("\n");
}

/**
 * A filename the storage layer will accept, that still ends in .pdf.
 *
 * `sanitizeFilename` strips path separators and anything exotic; this only has
 * to guarantee the extension, because a PDF saved as `offer` opens in whatever
 * the OS guesses.
 */
export function ensurePdfName(filename: string): string {
  const safe = sanitizeFilename(filename || "document.pdf");
  return safe.toLowerCase().endsWith(".pdf") ? safe : `${safe}.pdf`;
}
