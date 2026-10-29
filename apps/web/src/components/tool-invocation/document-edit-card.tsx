"use client";

import { ToolUIPart } from "ai";
import { toAny } from "lib/utils";
import { useState } from "react";
import {
  Check,
  X,
  FileText,
  Loader,
  Download,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "ui/button";
import { Badge } from "ui/badge";
import { TextShimmer } from "ui/text-shimmer";
import { toast } from "sonner";

interface EditChange {
  id: string;
  delId?: string;
  insId?: string;
  deletedText: string;
  insertedText: string;
  contextBefore: string;
  contextAfter: string;
  reason?: string;
}

interface EditOutput {
  storageKey?: string;
  url?: string;
  changes?: EditChange[];
  errors?: { index: number; reason: string }[];
}

interface EditInput {
  documentId?: string;
  edits?: unknown[];
  instruction?: string;
}

export function DocumentEditCard({ part }: { part: ToolUIPart }) {
  const input = toAny(part.input) as EditInput | null;
  const output = toAny(part.output) as EditOutput | null;
  const isStreaming = part.state.startsWith("input");
  const hasOutput = part.state.startsWith("output");

  const [resolving, setResolving] = useState<
    Record<string, "accepting" | "rejecting" | null>
  >({});
  const [resolved, setResolved] = useState<
    Record<string, "accepted" | "rejected">
  >({});
  const [expanded, setExpanded] = useState(true);

  const changes = output?.changes ?? [];
  const errors = output?.errors ?? [];
  const docUrl = output?.url;

  const resolve = async (changeId: string, mode: "accept" | "reject") => {
    if (!input?.documentId) return;
    setResolving((p) => ({
      ...p,
      [changeId]: mode === "accept" ? "accepting" : "rejecting",
    }));
    try {
      const res = await fetch(`/api/documents/${input.documentId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          changeIds: [changeId],
          mode,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await res.json();
      setResolved((p) => ({
        ...p,
        [changeId]: mode === "accept" ? "accepted" : "rejected",
      }));
    } catch (err) {
      toast.error(
        `Failed to ${mode}: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setResolving((p) => ({ ...p, [changeId]: null }));
    }
  };

  const acceptAll = async () => {
    const pending = changes.filter((c) => !resolved[c.id]);
    for (const c of pending) {
      await resolve(c.id, "accept");
    }
  };

  const rejectAll = async () => {
    const pending = changes.filter((c) => !resolved[c.id]);
    for (const c of pending) {
      await resolve(c.id, "reject");
    }
  };

  return (
    <div className="flex flex-col px-6 py-3">
      <div className="border rounded-lg overflow-hidden shadow animate-in fade-in duration-500">
        <div className="py-2.5 bg-border px-4 flex items-center gap-1.5 min-h-[37px]">
          {isStreaming ? (
            <>
              <Loader className="size-3 animate-spin text-muted-foreground" />
              <TextShimmer className="text-xs">
                Generating tracked changes…
              </TextShimmer>
            </>
          ) : (
            <>
              <FileText className="size-3 text-muted-foreground" />
              <span className="text-xs font-medium">Document Edits</span>
              {changes.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4 px-1">
                  {changes.length} change{changes.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </>
          )}
          <div className="flex-1" />
          {hasOutput && changes.length > 0 && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-[10px] text-green-600 hover:text-green-700"
                onClick={acceptAll}
              >
                <Check className="size-3" />
                Accept All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 text-[10px] text-destructive hover:text-destructive"
                onClick={rejectAll}
              >
                <X className="size-3" />
                Reject All
              </Button>
            </>
          )}
          {docUrl && (
            <a href={docUrl} download>
              <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs">
                <Download className="size-3" />
                Download
              </Button>
            </a>
          )}
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            {expanded ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </button>
        </div>

        {expanded && hasOutput && (
          <div className="divide-y">
            {changes.length === 0 && errors.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground text-center">
                No changes applied.
              </div>
            )}

            {changes.map((change) => {
              const state = resolved[change.id];
              const isResolving = resolving[change.id];
              return (
                <div
                  key={change.id}
                  className={`p-4 text-sm transition-opacity ${state ? "opacity-50" : ""}`}
                >
                  {change.reason && (
                    <p className="text-xs text-muted-foreground mb-2 italic">
                      {change.reason}
                    </p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {change.deletedText && (
                      <span className="bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded text-xs line-through">
                        {change.deletedText}
                      </span>
                    )}
                    {change.insertedText && (
                      <span className="bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded text-xs">
                        {change.insertedText}
                      </span>
                    )}
                  </div>
                  {!state && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 text-[10px] border-green-500 text-green-600 hover:bg-green-50"
                        disabled={!!isResolving}
                        onClick={() => resolve(change.id, "accept")}
                      >
                        {isResolving === "accepting" ? (
                          <Loader className="size-2.5 animate-spin" />
                        ) : (
                          <Check className="size-2.5" />
                        )}
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 text-[10px] border-destructive text-destructive hover:bg-destructive/10"
                        disabled={!!isResolving}
                        onClick={() => resolve(change.id, "reject")}
                      >
                        {isResolving === "rejecting" ? (
                          <Loader className="size-2.5 animate-spin" />
                        ) : (
                          <X className="size-2.5" />
                        )}
                        Reject
                      </Button>
                    </div>
                  )}
                  {state && (
                    <Badge
                      variant={state === "accepted" ? "default" : "destructive"}
                      className="text-[10px] h-4 mt-2"
                    >
                      {state}
                    </Badge>
                  )}
                </div>
              );
            })}

            {errors.map((err) => (
              <div key={err.index} className="p-4 text-xs text-destructive">
                Edit #{err.index + 1}: {err.reason}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
