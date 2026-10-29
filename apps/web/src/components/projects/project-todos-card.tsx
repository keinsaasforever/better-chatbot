"use client";

import type {
  ProjectTodoRow,
  ProjectTodoStatus,
} from "@/hooks/queries/use-project-overview";
import { ExternalLink, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "ui/badge";
import { Button } from "ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "ui/card";
import { Checkbox } from "ui/checkbox";
import { Skeleton } from "ui/skeleton";

const PRIORITY_STYLES: Record<string, string> = {
  critical: "border-red-500/40 text-red-600",
  high: "border-amber-500/40 text-amber-600",
};

function formatDue(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function ProjectTodosCard({
  todos,
  recentlyDone,
  isLoading,
  canEdit,
  onSetStatus,
}: {
  todos: ProjectTodoRow[] | undefined;
  recentlyDone: ProjectTodoRow[] | undefined;
  isLoading: boolean;
  canEdit: boolean;
  onSetStatus: (todoId: string, status: ProjectTodoStatus) => Promise<void>;
}) {
  const t = useTranslations("Projects");
  const [showDone, setShowDone] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const change = async (todoId: string, status: ProjectTodoStatus) => {
    setBusyId(todoId);
    try {
      await onSetStatus(todoId, status);
    } catch {
      toast.error(t("todoUpdateFailed"));
    } finally {
      setBusyId(null);
    }
  };

  const openCount = todos?.length ?? 0;
  const doneCount = recentlyDone?.length ?? 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 py-4">
        <CardTitle className="text-base">{t("todosTitle")}</CardTitle>
        <span className="text-xs text-muted-foreground">
          {t("openCount", { count: openCount })}
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && !todos ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : openCount === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noTodos")}</p>
        ) : (
          todos?.map((todo) => (
            <div key={todo.id} className="group flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={false}
                disabled={!canEdit || busyId === todo.id}
                aria-label={t("markDone")}
                onCheckedChange={() => change(todo.id, "done")}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {todo.sourceUrl ? (
                    <a
                      href={todo.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      {todo.title}
                      <ExternalLink className="size-3 text-muted-foreground" />
                    </a>
                  ) : (
                    <span>{todo.title}</span>
                  )}
                  {PRIORITY_STYLES[todo.priority] && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] px-1.5 py-0 ${PRIORITY_STYLES[todo.priority]}`}
                    >
                      {t(`priority.${todo.priority}`)}
                    </Badge>
                  )}
                </div>
                {(todo.dueAt || todo.sourceLabel || todo.detail) && (
                  <p className="text-xs text-muted-foreground">
                    {[
                      todo.dueAt
                        ? t("due", { date: formatDue(todo.dueAt) })
                        : null,
                      todo.sourceLabel
                        ? t("from", { source: todo.sourceLabel })
                        : null,
                      todo.detail,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                  title={t("dismiss")}
                  aria-label={t("dismiss")}
                  disabled={busyId === todo.id}
                  onClick={() => change(todo.id, "dismissed")}
                >
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          ))
        )}

        {doneCount > 0 && (
          <div className="pt-1">
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => setShowDone((value) => !value)}
            >
              {showDone ? t("hideDone") : t("showDone", { count: doneCount })}
            </button>
            {showDone && (
              <ul className="mt-2 space-y-1">
                {recentlyDone?.map((todo) => (
                  <li
                    key={todo.id}
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                  >
                    <span className="flex-1 truncate line-through">
                      {todo.title}
                    </span>
                    {canEdit && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 shrink-0"
                        title={t("reopen")}
                        aria-label={t("reopen")}
                        disabled={busyId === todo.id}
                        onClick={() => change(todo.id, "open")}
                      >
                        <RotateCcw className="size-3.5" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
