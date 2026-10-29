export type RequestInputOption = {
  label: string;
  description?: string;
};

export type RequestInputQuestion = {
  header: string;
  question: string;
  options: RequestInputOption[];
  multiSelect: boolean;
  placeholder?: string;
  inputType: "text" | "password" | "number" | "email" | "url";
};

const INPUT_TYPES = new Set([
  "text",
  "password",
  "number",
  "email",
  "url",
] as const satisfies readonly RequestInputQuestion["inputType"][]);

function asInputType(value: unknown): RequestInputQuestion["inputType"] {
  return typeof value === "string" &&
    INPUT_TYPES.has(value as RequestInputQuestion["inputType"])
    ? (value as RequestInputQuestion["inputType"])
    : "text";
}

function asOptions(value: unknown): RequestInputOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    // A model can emit a bare string where the schema asks for an object; that
    // is still a usable choice, so take it rather than dropping the question's
    // options entirely.
    if (typeof entry === "string" && entry.trim()) {
      return [{ label: entry.trim() }];
    }
    if (entry && typeof entry === "object") {
      const label = (entry as { label?: unknown }).label;
      const description = (entry as { description?: unknown }).description;
      if (typeof label === "string" && label.trim()) {
        return [
          {
            label: label.trim(),
            ...(typeof description === "string" && description.trim()
              ? { description: description.trim() }
              : {}),
          },
        ];
      }
    }
    return [];
  });
}

/**
 * Read a `requestInput` tool call into the shape the card renders.
 *
 * Handles two inputs deliberately. The current schema sends `questions`; calls
 * already stored in threads carry the old flat `{ label, placeholder,
 * inputType }`, and those messages are replayed forever, so a card that only
 * understood the new shape would render blank on every old conversation.
 * Anything unrecognisable yields an empty list, which the card treats as
 * nothing to ask.
 */
export function normalizeRequestInputQuestions(
  input: unknown,
): RequestInputQuestion[] {
  if (!input || typeof input !== "object") return [];
  const record = input as Record<string, unknown>;

  const raw = Array.isArray(record.questions) ? record.questions : null;
  if (raw) {
    return raw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const question =
        typeof item.question === "string" ? item.question.trim() : "";
      if (!question) return [];
      const header = typeof item.header === "string" ? item.header.trim() : "";
      return [
        {
          header: header || question,
          question,
          options: asOptions(item.options),
          multiSelect: item.multiSelect === true,
          placeholder:
            typeof item.placeholder === "string" && item.placeholder.trim()
              ? item.placeholder.trim()
              : undefined,
          inputType: asInputType(item.inputType),
        },
      ];
    });
  }

  // Legacy single-question shape.
  const label = typeof record.label === "string" ? record.label.trim() : "";
  if (!label) return [];
  return [
    {
      header: label,
      question: label,
      options: [],
      multiSelect: false,
      placeholder:
        typeof record.placeholder === "string" && record.placeholder.trim()
          ? record.placeholder.trim()
          : undefined,
      inputType: asInputType(record.inputType),
    },
  ];
}

/** Every question needs a non-empty answer before the card can submit. */
export function isRequestInputComplete(
  questions: RequestInputQuestion[],
  answers: Record<number, string>,
): boolean {
  if (questions.length === 0) return false;
  return questions.every(
    (_, index) => (answers[index] ?? "").trim().length > 0,
  );
}
