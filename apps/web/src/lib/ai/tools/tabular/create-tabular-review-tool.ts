import { JSONSchema7 } from "json-schema";
import { tool as createTool } from "ai";
import { jsonSchemaToZod } from "lib/json-schema-to-zod";

const columnPresetIds = [
  "summary",
  "key_dates",
  "parties",
  "obligations",
  "risks",
  "penalty",
  "jurisdiction",
  "custom",
] as const;

const columnTypeIds = [
  "text",
  "date",
  "boolean",
  "list",
  "score",
  "citation",
] as const;

export const createTabularReviewSchema: JSONSchema7 = {
  type: "object",
  properties: {
    documentIds: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
      description:
        "UUIDs of the documents to include as rows. Each document becomes one row.",
    },
    title: {
      type: "string",
      description: "Short descriptive title for the review table.",
    },
    columns: {
      type: "array",
      description: "Column definitions. At least one column is required.",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description:
              "Slug-style identifier for the column (lowercase, no spaces).",
          },
          label: {
            type: "string",
            description: "Display label for the column header.",
          },
          preset: {
            type: "string",
            enum: [...columnPresetIds],
            description:
              "Use a preset for common legal/document review fields, or 'custom' for a bespoke column.",
          },
          type: {
            type: "string",
            enum: [...columnTypeIds],
            description:
              "Data type: text, date, boolean, list, score (0–10), or citation.",
          },
          prompt: {
            type: "string",
            description:
              "For 'custom' columns — specific question to ask the LLM about each document.",
          },
        },
        required: ["id", "label", "type"],
      },
    },
  },
  required: ["documentIds", "title", "columns"],
};

export const createTabularReviewTool = createTool({
  description: `Create a multi-document tabular review table.
Use this when the user wants to compare multiple uploaded documents side-by-side, extract the same fields from each one, or produce a structured comparison (e.g., contract comparison, due diligence review, competitive analysis).

Each document becomes a row; each column extracts a specific piece of information from the document.

Available column presets: summary, key_dates, parties, obligations, risks, penalty, jurisdiction, custom.
Column types: text, date, boolean, list, score (0–10), citation.

After creating the table, cells are generated automatically — one LLM call per document per column.
The result is an interactive table that can be exported to Excel.`,
  inputSchema: jsonSchemaToZod(createTabularReviewSchema),
});
