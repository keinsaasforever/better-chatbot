export type ColumnType =
  | "text"
  | "date"
  | "boolean"
  | "list"
  | "score"
  | "citation";

export interface ColumnDef {
  id: string;
  label: string;
  type: ColumnType;
  prompt: string;
}

export const COLUMN_PRESETS: Record<string, ColumnDef> = {
  summary: {
    id: "summary",
    label: "Summary",
    type: "text",
    prompt:
      "Write a concise 2–4 sentence summary of this document's main purpose and content.",
  },
  key_dates: {
    id: "key_dates",
    label: "Key Dates",
    type: "list",
    prompt:
      "List all important dates mentioned in this document (effective date, expiry, deadlines, etc.). Format each as 'YYYY-MM-DD: description'.",
  },
  parties: {
    id: "parties",
    label: "Parties",
    type: "list",
    prompt:
      "List all parties named in this document (full legal names and their roles).",
  },
  obligations: {
    id: "obligations",
    label: "Key Obligations",
    type: "list",
    prompt:
      "List the primary obligations and commitments for each party in this document.",
  },
  risks: {
    id: "risks",
    label: "Risks & Red Flags",
    type: "list",
    prompt:
      "Identify any unusual, risky, or one-sided clauses, missing standard protections, or liability concerns.",
  },
  penalty: {
    id: "penalty",
    label: "Penalties & Remedies",
    type: "text",
    prompt:
      "Describe any penalty clauses, liquidated damages, indemnification provisions, or breach remedies.",
  },
  jurisdiction: {
    id: "jurisdiction",
    label: "Jurisdiction & Governing Law",
    type: "text",
    prompt:
      "State the governing law and dispute resolution mechanism (court, arbitration, etc.).",
  },
};

export function resolveColumnPrompt(col: {
  preset?: string;
  type: ColumnType;
  prompt?: string;
  label: string;
}): string {
  if (col.preset && col.preset !== "custom" && COLUMN_PRESETS[col.preset]) {
    return COLUMN_PRESETS[col.preset].prompt;
  }
  if (col.prompt) return col.prompt;
  return `Extract the "${col.label}" from this document.`;
}

export function formatPromptSuffix(type: ColumnType): string {
  switch (type) {
    case "date":
      return " Return only the date in ISO 8601 format (YYYY-MM-DD) or 'N/A' if not found.";
    case "boolean":
      return " Answer only 'Yes', 'No', or 'N/A'.";
    case "list":
      return " Return a bullet list with each item on its own line prefixed with '- '. If nothing found, return 'None identified.'";
    case "score":
      return " Return only an integer from 0 to 10 followed by a one-sentence justification. Format: '7 — reason'.";
    case "citation":
      return " Include inline [N] citations and a <CITATIONS> block at the end.";
    case "text":
    default:
      return "";
  }
}
