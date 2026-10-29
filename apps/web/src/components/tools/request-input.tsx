"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type RequestInputQuestion,
  isRequestInputComplete,
} from "@/lib/chat/request-input-questions";
import { cn } from "@/lib/utils";

export type RequestInputAnswer = {
  header: string;
  question: string;
  value: string;
};

interface RequestInputProps {
  questions: RequestInputQuestion[];
  onSubmit?: (answers: RequestInputAnswer[]) => void;
  /** Set once the call has a result; the card then renders read-only. */
  submittedAnswers?: RequestInputAnswer[];
}

/**
 * RequestInputUI
 *
 * Collects every answer the model asked for in one card: each question offers
 * its suggested options and a free-text field beside them, so a listed choice
 * is a shortcut rather than the only way to answer.
 *
 * Answers are held per question index and submitted together — the tool call is
 * one call, so it takes one result.
 */
export function RequestInputUI({
  questions,
  onSubmit,
  submittedAnswers,
}: RequestInputProps) {
  const t = useTranslations("Chat.Hitl.input");
  const [answers, setAnswers] = useState<Record<number, string>>({});
  // Tracks which option chip is highlighted. Typing clears it, so the card
  // never shows a selected chip next to different free text.
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [isSubmitted, setIsSubmitted] = useState(false);

  const isReadOnly = Boolean(submittedAnswers) || isSubmitted;

  const canSubmit = useMemo(
    () => isRequestInputComplete(questions, answers),
    [questions, answers],
  );

  const toggleOption = useCallback(
    (index: number, question: RequestInputQuestion, label: string) => {
      setPicked((prev) => {
        const current = prev[index] ?? [];
        const next = question.multiSelect
          ? current.includes(label)
            ? current.filter((entry) => entry !== label)
            : [...current, label]
          : current.includes(label)
            ? []
            : [label];
        setAnswers((prevAnswers) => ({
          ...prevAnswers,
          [index]: next.join(", "),
        }));
        return { ...prev, [index]: next };
      });
    },
    [],
  );

  const setFreeText = useCallback((index: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [index]: value }));
    // Free text replaces the picked options rather than appending to them.
    setPicked((prev) => ({ ...prev, [index]: [] }));
  }, []);

  const handleSubmit = useCallback(() => {
    if (!canSubmit || isReadOnly) return;
    setIsSubmitted(true);
    onSubmit?.(
      questions.map((question, index) => ({
        header: question.header,
        question: question.question,
        value: (answers[index] ?? "").trim(),
      })),
    );
  }, [answers, canSubmit, isReadOnly, onSubmit, questions]);

  if (questions.length === 0) return null;

  const rendered: RequestInputAnswer[] | undefined =
    submittedAnswers ??
    (isSubmitted
      ? questions.map((question, index) => ({
          header: question.header,
          question: question.question,
          value: (answers[index] ?? "").trim(),
        }))
      : undefined);

  return (
    <div className="my-3">
      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("title")}
          {rendered && (
            <span className="ml-auto flex items-center gap-1 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              {t("submitted")}
            </span>
          )}
        </div>

        <div className="space-y-5 px-4 py-4 text-sm">
          {questions.map((question, index) => {
            const answered = rendered?.[index]?.value ?? "";
            const selected = picked[index] ?? [];
            const fieldId = `request-input-${index}`;

            return (
              <div className="space-y-2" key={`${question.header}-${index}`}>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {question.header}
                  </span>
                </div>
                <p className="text-foreground">{question.question}</p>

                {rendered ? (
                  <div className="whitespace-pre-wrap rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
                    {question.inputType === "password" ? "••••••••" : answered}
                  </div>
                ) : (
                  <>
                    {question.options.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {question.options.map((option) => {
                          const isPicked = selected.includes(option.label);
                          return (
                            <button
                              className={cn(
                                "rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                                isPicked
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border text-muted-foreground hover:bg-input hover:text-foreground",
                              )}
                              key={option.label}
                              onClick={() =>
                                toggleOption(index, question, option.label)
                              }
                              type="button"
                            >
                              <span className="font-medium">
                                {option.label}
                              </span>
                              {option.description && (
                                <span className="block text-[11px] opacity-80">
                                  {option.description}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <Input
                      aria-label={question.question}
                      className="h-10 rounded-md border-border bg-background text-sm text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      id={fieldId}
                      onChange={(event) =>
                        setFreeText(index, event.target.value)
                      }
                      placeholder={
                        question.placeholder ??
                        (question.options.length > 0
                          ? t("otherPlaceholder")
                          : t("answerPlaceholder"))
                      }
                      type={question.inputType}
                      value={answers[index] ?? ""}
                    />
                  </>
                )}
              </div>
            );
          })}

          {!rendered && (
            <div className="flex items-center gap-2 border-t border-border pt-3">
              <Button
                disabled={!canSubmit}
                onClick={handleSubmit}
                size="sm"
                type="button"
              >
                {t("submit")}
              </Button>
              <p className="text-xs text-muted-foreground">{t("hint")}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
