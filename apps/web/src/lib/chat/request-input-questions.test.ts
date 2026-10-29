import { describe, expect, test } from "vitest";
import {
  isRequestInputComplete,
  normalizeRequestInputQuestions,
} from "./request-input-questions";

describe("normalizeRequestInputQuestions", () => {
  test("reads the questions shape the tool now emits", () => {
    const questions = normalizeRequestInputQuestions({
      questions: [
        {
          header: "Cadence",
          question: "How often should it run?",
          options: [
            { label: "Weekly", description: "Every Monday" },
            { label: "Daily" },
          ],
          multiSelect: false,
          inputType: "text",
        },
      ],
    });

    expect(questions).toHaveLength(1);
    expect(questions[0].header).toBe("Cadence");
    expect(questions[0].options).toEqual([
      { label: "Weekly", description: "Every Monday" },
      { label: "Daily" },
    ]);
  });

  test("still renders the legacy flat shape stored in old threads", () => {
    // Messages are replayed forever, so a card that only understood the new
    // shape would come back blank on every conversation already in the DB.
    const questions = normalizeRequestInputQuestions({
      label: "What is your API key?",
      placeholder: "sk-…",
      inputType: "password",
    });

    expect(questions).toEqual([
      {
        header: "What is your API key?",
        question: "What is your API key?",
        options: [],
        multiSelect: false,
        placeholder: "sk-…",
        inputType: "password",
      },
    ]);
  });

  test("accepts options given as bare strings", () => {
    // A model can emit strings where the schema asks for objects; dropping the
    // whole option list over that would leave the user with only free text.
    const [question] = normalizeRequestInputQuestions({
      questions: [{ header: "H", question: "Q", options: ["Yes", "No"] }],
    });

    expect(question.options).toEqual([{ label: "Yes" }, { label: "No" }]);
  });

  test("falls back to the question when no header is given", () => {
    const [question] = normalizeRequestInputQuestions({
      questions: [{ question: "Which channel?" }],
    });

    expect(question.header).toBe("Which channel?");
  });

  test("drops entries with no question text", () => {
    expect(
      normalizeRequestInputQuestions({
        questions: [{ header: "H" }, { question: "   " }],
      }),
    ).toEqual([]);
  });

  test("rejects an unusable input type rather than trusting it", () => {
    const [question] = normalizeRequestInputQuestions({
      questions: [{ question: "Q", inputType: "javascript:" }],
    });

    expect(question.inputType).toBe("text");
  });

  test("returns nothing for input it cannot read", () => {
    expect(normalizeRequestInputQuestions(null)).toEqual([]);
    expect(normalizeRequestInputQuestions("nope")).toEqual([]);
    expect(normalizeRequestInputQuestions({})).toEqual([]);
  });
});

describe("isRequestInputComplete", () => {
  const question = {
    header: "H",
    question: "Q",
    options: [],
    multiSelect: false,
    inputType: "text" as const,
  };

  test("requires an answer to every question", () => {
    expect(isRequestInputComplete([question, question], { 0: "a" })).toBe(
      false,
    );
    expect(
      isRequestInputComplete([question, question], { 0: "a", 1: "b" }),
    ).toBe(true);
  });

  test("treats whitespace as unanswered", () => {
    expect(isRequestInputComplete([question], { 0: "   " })).toBe(false);
  });

  test("is never complete with no questions", () => {
    expect(isRequestInputComplete([], {})).toBe(false);
  });
});
