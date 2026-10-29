import { tool as createTool } from "ai";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";
import { createPdfSchema } from "./create-pdf-schema";

/**
 * Stand-in for `create-pdf` in the static toolkit map.
 *
 * The real tool needs the request's user (for billing, and for the storage key
 * the PDF is written under), which a module-level map has no access to, so
 * `tool-loading.ts` swaps this for the bound one. It also drops it entirely
 * when the active sandbox template has no WeasyPrint — better no tool than one
 * the model calls and that always fails.
 *
 * It exists at all so the toolkit toggle has something to gate, matching how
 * the browser toolkit is wired. Executing it would mean the swap did not
 * happen; it says so rather than silently doing nothing.
 */
export const createPdfPlaceholderTool = createTool({
  description:
    "Render a document as a PDF the user can download. (Bound per request.)",
  inputSchema: jsonSchemaToZod(createPdfSchema),
  execute: async () => ({
    success: false,
    error:
      "PDF rendering is not available in this environment. Produce the document with python-execution instead.",
  }),
});
