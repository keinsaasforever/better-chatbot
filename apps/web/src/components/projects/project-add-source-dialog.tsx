"use client";

import { useState } from "react";
import { ClipboardPaste, CloudUpload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Input } from "ui/input";
import { Textarea } from "ui/textarea";

const MIN_TEXT_LENGTH = 20;

/**
 * "+ Add source" on the Brain tab. Offers file upload (delegates to the
 * existing ProjectUploadDialog via `onUploadFiles`) or pasting raw text such
 * as a meeting transcript, which is ingested into the project knowledge base
 * and brain.
 */
export function ProjectAddSourceDialog({
  projectId,
  open,
  onOpenChange,
  onUploadFiles,
  onIngested,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadFiles: () => void;
  onIngested?: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "paste">("choose");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setMode("choose");
      setTitle("");
      setText("");
    }
  };

  const submitText = async () => {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/sources/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          text: text.trim(),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          payload?.error?.message ?? "Could not ingest the pasted text.",
        );
      }
      onIngested?.();
      handleOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not ingest the pasted text.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>
            Feed the project brain with documents or pasted text such as meeting
            transcripts.
          </DialogDescription>
        </DialogHeader>

        {mode === "choose" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                handleOpenChange(false);
                onUploadFiles();
              }}
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
            >
              <CloudUpload className="size-6" />
              <span className="text-sm font-medium">Upload files</span>
              <span className="text-xs">PDF, CSV, TXT, MD</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("paste")}
              className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-muted-foreground hover:border-primary/40 hover:text-foreground transition-all"
            >
              <ClipboardPaste className="size-6" />
              <span className="text-sm font-medium">Paste text</span>
              <span className="text-xs">Meeting transcript, notes…</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Title (optional), e.g. Kickoff call 2026-07-18"
              maxLength={200}
            />
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste the transcript or notes here…"
              className="min-h-[220px]"
            />
            <p className="text-xs text-muted-foreground">
              The text is embedded for retrieval and analyzed into the project
              memory, todos and widgets.
            </p>
          </div>
        )}

        {mode === "paste" && (
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setMode("choose")}
              disabled={submitting}
            >
              Back
            </Button>
            <Button
              onClick={submitText}
              disabled={submitting || text.trim().length < MIN_TEXT_LENGTH}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Ingesting…
                </>
              ) : (
                "Add source"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
