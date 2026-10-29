"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Circle, Clock, CornerRightUp, X } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";

interface Todo {
  text: string;
  status: "pending" | "in_progress" | "completed";
}

interface PlanApprovalProps {
  todos: Todo[];
  explainer: string;
  onApprove: (editedTodos: Todo[]) => void;
  onReject: () => void;
  /** Send a comment / a different idea back instead of approving or rejecting. */
  onFeedback?: (comment: string, currentTodos: Todo[]) => void;
}

/**
 * PlanApprovalUI Component
 *
 * Displays a multi-step plan for user review and approval.
 * Adapted from mastra-hitl for AI SDK 6.
 *
 * Features:
 * - Editable todo list with status icons
 * - Delete button for each todo
 * - Plan explainer text
 * - Approve & Continue button
 * - Reject Plan button
 * - Visual status indicators (pending, in_progress, completed)
 */
export function PlanApprovalUI({
  todos: initialTodos,
  explainer,
  onApprove,
  onReject,
  onFeedback,
}: PlanApprovalProps) {
  const [todos, setTodos] = useState<Todo[]>(initialTodos);
  const [isProcessing, setIsProcessing] = useState(false);
  const [comment, setComment] = useState("");

  const trimmedComment = comment.trim();

  const handleFeedback = async () => {
    if (!onFeedback || !trimmedComment) return;
    setIsProcessing(true);
    await onFeedback(trimmedComment, todos);
  };

  const handleApprove = async () => {
    setIsProcessing(true);
    // Filter out empty todos before approving
    const validTodos = todos.filter((todo) => todo.text.trim().length > 0);
    await onApprove(validTodos);
  };

  const handleReject = async () => {
    setIsProcessing(true);
    await onReject();
  };

  const handleTodoChange = (index: number, text: string) => {
    setTodos((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], text };
      return next;
    });
  };

  const t = useTranslations("Chat.Hitl.plan");

  const handleDeleteTodo = (index: number) => {
    setTodos((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="border-b border-border px-4 py-2 text-xs font-medium uppercase text-muted-foreground">
        {t("title")}
      </div>

      <div className="px-4 py-3">
        {/* Explainer */}
        {explainer && (
          <p className="mb-4 text-sm text-muted-foreground">{explainer}</p>
        )}

        {/* Todo List */}
        <ul className="flex flex-col gap-2">
          {todos.map((todo, index) => {
            const Icon =
              todo.status === "completed"
                ? CheckCircle2
                : todo.status === "in_progress"
                  ? Clock
                  : Circle;

            const iconColor =
              todo.status === "completed"
                ? "text-emerald-600"
                : todo.status === "in_progress"
                  ? "text-blue-600"
                  : "text-muted-foreground";

            return (
              <li key={index} className="flex items-start gap-2 group">
                <Icon
                  className={cn("mt-0.5 h-4 w-4 flex-shrink-0", iconColor)}
                />
                <input
                  value={todo.text}
                  onChange={(e) => handleTodoChange(index, e.target.value)}
                  className="flex-1 bg-transparent text-sm text-foreground outline-none focus:underline"
                  disabled={isProcessing}
                  placeholder={t("taskPlaceholder")}
                />
                <button
                  type="button"
                  onClick={() => handleDeleteTodo(index)}
                  disabled={isProcessing}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive disabled:opacity-50"
                  aria-label={t("deleteTask")}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>

        {todos.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            All tasks removed. Add at least one task to continue.
          </p>
        )}

        {/* Comment / different idea — the plan is a proposal, not a menu of
            two answers. Anything typed here goes back to the model as
            requested changes instead of an approval or a rejection. */}
        {onFeedback && (
          <div className="mt-4">
            <div className="relative">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleFeedback();
                  }
                }}
                disabled={isProcessing}
                rows={2}
                placeholder={t("commentPlaceholder")}
                className="min-h-16 resize-none pr-12 text-sm"
                aria-label={t("commentLabel")}
              />
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="absolute bottom-2 right-2 size-8 rounded-full"
                onClick={handleFeedback}
                disabled={isProcessing || !trimmedComment}
                aria-label={t("sendComment")}
              >
                <CornerRightUp className="size-4" />
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              You can also just answer in the chat below — that replaces this
              plan.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={handleReject}
            disabled={isProcessing}
          >
            {t("reject")}
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isProcessing || todos.length === 0}
          >
            {t("approve")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Helper function
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}
