"use client";

import { ToolUIPart } from "ai";
import {
  hasUnansweredCells,
  isAnsweredCell,
  type StoredCell,
} from "lib/tabular/cell-completion";
import { toAny } from "lib/utils";
import { useEffect, useRef, useState } from "react";
import { Loader, Download, Table2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "ui/button";
import { Badge } from "ui/badge";
import { TextShimmer } from "ui/text-shimmer";
import { toast } from "sonner";

interface ColumnDef {
  id: string;
  label: string;
  type: string;
}

interface ReviewInput {
  title?: string;
  documentIds?: string[];
  columns?: ColumnDef[];
}

interface ReviewOutput {
  id?: string;
  title?: string;
  error?: string;
}

interface CellUpdate {
  documentId: string;
  columnId: string;
  value: string;
  status: "done" | "error";
}

interface DocumentRow {
  documentId: string;
  filename: string;
  rowIndex: number;
}

export function TabularReviewCard({ part }: { part: ToolUIPart }) {
  const input = toAny(part.input) as ReviewInput | null;
  const output = toAny(part.output) as ReviewOutput | null;
  const isStreaming = part.state.startsWith("input");
  const hasOutput = part.state.startsWith("output");

  const [isGenerating, setIsGenerating] = useState(false);
  const [cells, setCells] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const hasStarted = useRef(false);

  const reviewId = output?.id;
  const columns = input?.columns ?? [];

  useEffect(() => {
    if (!hasOutput || !reviewId || hasStarted.current) return;
    hasStarted.current = true;

    fetch(`/api/tabular-review/${reviewId}/generate`)
      .then((res) => res.json())
      .then(
        (data: {
          documents?: DocumentRow[];
          cells?: StoredCell[];
        }) => {
          const docList = data.documents ?? [];
          setDocuments(docList);

          const storedCells = data.cells ?? [];
          const initial: Record<string, Record<string, string>> = {};
          for (const cell of storedCells) {
            // Only answers. A "pending" or "error" cell holding an empty string
            // used to render as a finished, blank result.
            if (!isAnsweredCell(cell)) continue;
            if (!initial[cell.documentId]) initial[cell.documentId] = {};
            initial[cell.documentId][cell.columnId] = cell.value ?? "";
          }
          setCells(initial);

          // `hasStarted` is a ref, so it resets on every remount - reopening the
          // thread used to re-run, and re-bill, the whole grid even though every
          // answer was already stored.
          if (!hasUnansweredCells(storedCells)) {
            setIsComplete(true);
            return;
          }

          startGeneration(reviewId, docList);
        },
      )
      .catch((err) => toast.error(`Failed to load review: ${err.message}`));
  }, [hasOutput, reviewId]);

  const startGeneration = (id: string, _docList: DocumentRow[]) => {
    setIsGenerating(true);

    // POST triggers the SSE stream (EventSource only supports GET, so we use fetch).
    fetch(`/api/tabular-review/${id}/generate`, { method: "POST" })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          toast.error("Failed to start cell generation.");
          setIsGenerating(false);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processEvent = (eventBlock: string) => {
          const lines = eventBlock.split("\n");
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!dataLine) return;
          try {
            const raw = dataLine.slice(5).trim();
            const data = JSON.parse(raw) as
              | (CellUpdate & { type: "cell_update" })
              | { type: "row_complete"; documentId: string }
              | { type: "complete" }
              | { type: "error"; message: string };

            if (data.type === "cell_update") {
              setCells((prev) => ({
                ...prev,
                [data.documentId]: {
                  ...(prev[data.documentId] ?? {}),
                  [data.columnId]: data.value,
                },
              }));
            } else if (data.type === "complete") {
              setIsComplete(true);
              setIsGenerating(false);
            } else if (data.type === "error") {
              toast.error(`Generation error: ${data.message}`);
              setIsGenerating(false);
            }
          } catch {
            // ignore parse errors on malformed events
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            if (part.trim()) processEvent(part);
          }
        }
        setIsGenerating(false);
      })
      .catch((err) => {
        toast.error(`Generation error: ${err.message}`);
        setIsGenerating(false);
      });
  };

  const exportExcel = () => {
    if (!reviewId) return;
    window.open(`/api/tabular-review/${reviewId}/export`, "_blank");
  };

  const pendingDocs = input?.documentIds?.length ?? 0;
  const displayDocs =
    documents.length > 0
      ? documents
      : (input?.documentIds ?? []).map((id, i) => ({
          documentId: id,
          filename: `Document ${i + 1}`,
          rowIndex: i,
        }));

  return (
    <div className="flex flex-col px-6 py-3">
      <div className="border rounded-lg overflow-hidden shadow animate-in fade-in duration-500">
        <div className="py-2.5 bg-border px-4 flex items-center gap-1.5 min-h-[37px]">
          {isStreaming ? (
            <>
              <Loader className="size-3 animate-spin text-muted-foreground" />
              <TextShimmer className="text-xs">
                Creating tabular review…
              </TextShimmer>
            </>
          ) : (
            <>
              <Table2 className="size-3 text-muted-foreground" />
              <span className="text-xs font-medium">
                {input?.title ?? "Tabular Review"}
              </span>
              <Badge variant="secondary" className="text-[10px] h-4 px-1">
                {pendingDocs} doc{pendingDocs !== 1 ? "s" : ""} ×{" "}
                {columns.length} col{columns.length !== 1 ? "s" : ""}
              </Badge>
              {isGenerating && (
                <Badge
                  variant="outline"
                  className="text-[10px] h-4 px-1 animate-pulse"
                >
                  Generating…
                </Badge>
              )}
              {isComplete && (
                <Badge className="text-[10px] h-4 px-1 bg-green-600">
                  Complete
                </Badge>
              )}
            </>
          )}
          <div className="flex-1" />
          {isComplete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs"
              onClick={exportExcel}
            >
              <Download className="size-3" />
              Export
            </Button>
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

        {expanded && !isStreaming && columns.length > 0 && (
          <div className="overflow-auto max-h-[500px]">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50 sticky top-0 z-10">
                  <th className="text-left p-2.5 font-medium text-muted-foreground border-b min-w-[180px]">
                    Document
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.id}
                      className="text-left p-2.5 font-medium text-muted-foreground border-b min-w-[160px]"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayDocs.map((doc) => (
                  <tr
                    key={doc.documentId}
                    className="hover:bg-muted/20 transition-colors"
                  >
                    <td className="p-2.5 border-b align-top font-medium text-foreground max-w-[200px] truncate">
                      {doc.filename}
                    </td>
                    {columns.map((col) => {
                      const value = cells[doc.documentId]?.[col.id];
                      return (
                        <td
                          key={col.id}
                          className="p-2.5 border-b align-top text-muted-foreground max-w-[280px]"
                        >
                          {value !== undefined ? (
                            <span className="whitespace-pre-wrap">{value}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 opacity-50">
                              <Loader className="size-2.5 animate-spin" />
                              <span>Generating…</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
