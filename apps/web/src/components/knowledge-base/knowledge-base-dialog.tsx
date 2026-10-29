"use client";

import { useKnowledgeBases } from "@/hooks/queries/use-knowledge-bases";
import { Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Label } from "ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "ui/select";

export const CREATE_NEW = "__create_new__";

export type KnowledgeBaseTarget = {
  id: string;
  name: string;
  /**
   * Always "kb" from this dialog. The field stays because the retrieval
   * binding it feeds also covers agent-bound projects; the composer just does
   * not offer those (see knowledge-base-menu.tsx).
   */
  sourceType: "kb";
};

const ACCEPTED_FILE_TYPES =
  ".pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

/**
 * Chat-level knowledge base dialog: add documents to a knowledge base,
 * creating it on the way when the target is `CREATE_NEW`. The chosen target is
 * handed back through `onDone` so the composer can attach it to the thread.
 *
 * Projects are not targets here: their documents go in through the project's
 * own upload, which records them against the project and feeds its brain.
 */
export function KnowledgeBaseDialog({
  open,
  onOpenChange,
  /** Which target the select starts on — `CREATE_NEW`, or a `kb:` id. */
  initialTarget = CREATE_NEW,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTarget?: string;
  onDone?: (target: KnowledgeBaseTarget) => void;
}) {
  const t = useTranslations("Chat.KnowledgeBase");
  const tCommon = useTranslations("Common");
  const { knowledgeBases, isLoading, mutate } = useKnowledgeBases();
  const [target, setTarget] = useState<string>(initialTarget);
  const [newName, setNewName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Each opening is a fresh action: the menu decides whether this is a
  // "create" or an "add documents" flow, and a stale file selection from the
  // last run must never ride along into the next upload.
  useEffect(() => {
    if (!open) return;
    setTarget(initialTarget);
    setNewName("");
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, initialTarget]);

  const isCreateNew = target === CREATE_NEW;

  const resolvedTarget = useMemo<KnowledgeBaseTarget | null>(() => {
    if (isCreateNew) return null;
    const id = target.slice("kb:".length);
    return {
      id,
      sourceType: "kb",
      name: knowledgeBases.find((kb) => kb.id === id)?.name ?? "",
    };
  }, [isCreateNew, target, knowledgeBases]);

  const handleSubmit = async () => {
    if (isCreateNew && !newName.trim()) {
      toast.error(t("errorNoName"));
      return;
    }
    // Adding documents is the only reason to open the dialog on an existing
    // target, so an empty file list there is a mistake, not an empty create.
    if (!isCreateNew && files.length === 0) {
      toast.error(t("errorNoFile"));
      return;
    }

    setIsSubmitting(true);
    try {
      let uploaded: KnowledgeBaseTarget;
      if (isCreateNew) {
        const createResponse = await fetch("/api/knowledge-bases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim() }),
        });
        if (!createResponse.ok) {
          throw new Error("Failed to create the knowledge base");
        }
        const { knowledgeBase } = await createResponse.json();
        uploaded = {
          id: knowledgeBase.id,
          name: knowledgeBase.name,
          sourceType: "kb",
        };
        mutate();
      } else {
        uploaded = resolvedTarget!;
      }

      const uploadUrl = `/api/knowledge-bases/${uploaded.id}/upload`;

      // Sequential on purpose: ingestion provisions the namespace lazily, so
      // parallel first uploads would race that provisioning.
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          body: formData,
        });
        if (!uploadResponse.ok) {
          throw new Error("Upload failed");
        }
      }

      onDone?.(uploaded);
      onOpenChange(false);
    } catch (error) {
      console.error("Knowledge base upload failed:", error);
      toast.error(isCreateNew ? t("errorCreate") : t("errorUpload"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isCreateNew ? t("createTitle") : t("uploadTitle")}
          </DialogTitle>
          <DialogDescription>{t("dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="kb-target">{t("targetLabel")}</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger id="kb-target" disabled={isLoading}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={CREATE_NEW}>{t("createNew")}</SelectItem>
                {knowledgeBases.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t("knowledgeBases")}</SelectLabel>
                    {knowledgeBases.map((kb) => (
                      <SelectItem key={kb.id} value={`kb:${kb.id}`}>
                        {kb.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          {isCreateNew && (
            <div className="space-y-2">
              <Label htmlFor="kb-name">{t("nameLabel")}</Label>
              <Input
                id="kb-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("namePlaceholder")}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="kb-file">{t("filesLabel")}</Label>
            <Input
              id="kb-file"
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPTED_FILE_TYPES}
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            {isCreateNew && (
              <p className="text-muted-foreground text-xs">
                {t("filesOptional")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting && <Loader className="size-4 animate-spin" />}
            {isSubmitting
              ? t("submitting")
              : isCreateNew
                ? tCommon("create")
                : t("upload")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
