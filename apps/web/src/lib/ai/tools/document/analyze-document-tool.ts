import { JSONSchema7 } from "json-schema";
import { tool as createTool } from "ai";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";

export const analyzeDocumentSchema: JSONSchema7 = {
  type: "object",
  properties: {
    documentId: {
      type: "string",
      description:
        "Document UUID, doc slug such as doc-1, or exact filename from available_project_documents.",
    },
    question: {
      type: "string",
      description:
        "Specific question or instructions about what to extract, summarize, or find in the document.",
    },
  },
  required: ["documentId", "question"],
};

export const analyzeDocumentTool = createTool({
  description: `Analyze the content of an uploaded document (PDF or DOCX).
Use this when the user references a document they've uploaded and asks you to:
- Summarize or explain the document
- Answer questions about its content
- Find specific information in the document
- Extract key points, clauses, or data

Cite passages using the [N] format, collecting all citations in a <CITATIONS> block at the end.`,
  inputSchema: jsonSchemaToZod(analyzeDocumentSchema),
});

export const editDocumentSchema: JSONSchema7 = {
  type: "object",
  properties: {
    documentId: {
      type: "string",
      description: "UUID of the uploaded DOCX document to edit.",
    },
    edits: {
      type: "array",
      description: "List of tracked-change edits to apply to the document.",
      items: {
        type: "object",
        properties: {
          find: {
            type: "string",
            description:
              "Exact text to replace (copied verbatim from the document). Leave empty for a pure insertion.",
          },
          replace: {
            type: "string",
            description:
              "Replacement text. Leave empty to delete the found text.",
          },
          context_before: {
            type: "string",
            description:
              "20–50 characters immediately preceding the 'find' text to uniquely anchor the change.",
          },
          context_after: {
            type: "string",
            description:
              "20–50 characters immediately following the 'find' text to uniquely anchor the change.",
          },
          reason: {
            type: "string",
            description:
              "Brief explanation for the reviewer (shown in the tracked-change card).",
          },
        },
        required: ["context_before", "context_after"],
      },
    },
    instruction: {
      type: "string",
      description: "Overall editing instruction for context.",
    },
    author: {
      type: "string",
      description: "Author name that will appear in the tracked changes.",
    },
  },
  required: ["documentId", "edits"],
};

export const editDocumentTool = createTool({
  description: `Apply tracked changes to an uploaded DOCX document.
Use this when the user asks you to edit, revise, improve, or proofread a DOCX document.

Rules:
- First analyze the document with analyze-document to understand its content.
- Each edit specifies text to find (verbatim), replacement text, and surrounding context.
- Context anchors must be copied verbatim from the document so the matcher can locate the change uniquely.
- Keep each edit atomic (one logical change per edit).
- The result is a new DOCX with tracked changes that the user can accept or reject.`,
  inputSchema: jsonSchemaToZod(editDocumentSchema),
});
