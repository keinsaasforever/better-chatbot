"use client";

import { appStore } from "@/app/store";
import { useAssemblyAI } from "@/hooks/use-assembly-ai";
import { useFileUpload } from "@/hooks/use-presigned-upload";
import {
  PROBLEM_REPORT_DESCRIPTION_MAX,
  PROBLEM_REPORT_MAX_SCREENSHOTS,
  type ProblemReportScreenshot,
} from "app-types/problem-report";
import { cn } from "lib/utils";
import { ImagePlus, Loader2, MicIcon, Square, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { Textarea } from "ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "ui/tooltip";
import { useShallow } from "zustand/shallow";

/** Screenshots only — this is a bug report, not a file share. */
const ACCEPTED_TYPES = "image/png,image/jpeg,image/webp,image/gif";
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

type PendingScreenshot = {
  id: string;
  file: File;
  previewUrl: string;
};

const isAcceptedImage = (file: File) =>
  ACCEPTED_TYPES.split(",").includes(file.type);

/**
 * The "Report an issue" dialog.
 *
 * Replaces a `mailto:` link that produced reports nobody could query. A
 * submission now lands in Postgres, raises a Superlog incident, and mails the
 * tech inbox — see `app/api/problem-report/route.ts`.
 *
 * Description can be typed or dictated: the mic reuses the same AssemblyAI
 * streaming hook as the chat composer, and appends finalized turns into the
 * textarea so the user can still edit before sending. Dictated "senden" is
 * deliberately *not* treated as a submit command here — an accidental send is
 * far more costly in a form the user is still assembling evidence for.
 */
export function ProblemReportDialog() {
  const [open, appStoreMutate] = appStore(
    useShallow((state) => [state.openProblemReport, state.mutate]),
  );
  const t = useTranslations("ProblemReport");
  const locale = useLocale();

  const [description, setDescription] = useState("");
  const [screenshots, setScreenshots] = useState<PendingScreenshot[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dictation lands asynchronously, so the appender must read the latest text
  // rather than the value captured when the hook was created.
  const descriptionRef = useRef(description);
  useEffect(() => {
    descriptionRef.current = description;
  }, [description]);

  const appendTranscript = useCallback((text: string) => {
    if (!text) return;
    const current = descriptionRef.current;
    const spacer = current.length > 0 && !current.endsWith(" ") ? " " : "";
    setDescription(
      (current + spacer + text).slice(0, PROBLEM_REPORT_DESCRIPTION_MAX),
    );
  }, []);

  const { isListening, toggleListening, stopRecording } = useAssemblyAI({
    onTranscript: appendTranscript,
    onCommand: appendTranscript,
  });

  const { upload } = useFileUpload({ uploadType: "attachment" });

  // Every preview is an object URL, so the list has to be reachable from an
  // unmount cleanup that must NOT re-run whenever it changes — revoking on each
  // change would break the previews of the screenshots already attached.
  const screenshotsRef = useRef(screenshots);
  useEffect(() => {
    screenshotsRef.current = screenshots;
  }, [screenshots]);
  useEffect(
    () => () => {
      for (const shot of screenshotsRef.current) {
        URL.revokeObjectURL(shot.previewUrl);
      }
    },
    [],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;

      // Rejections are reported outside the state updater: React may invoke an
      // updater twice in development, which would double every toast.
      const current = screenshotsRef.current;
      const room = PROBLEM_REPORT_MAX_SCREENSHOTS - current.length;
      const accepted: PendingScreenshot[] = [];
      let overflowed = room <= 0;

      for (const file of files) {
        if (accepted.length >= room) {
          overflowed = true;
          break;
        }
        if (!isAcceptedImage(file)) {
          toast.error(t("unsupportedFile", { name: file.name }));
          continue;
        }
        if (file.size > MAX_SCREENSHOT_BYTES) {
          toast.error(t("screenshotTooLarge", { name: file.name }));
          continue;
        }
        accepted.push({
          id: `${file.name}-${file.size}-${Date.now()}-${accepted.length}`,
          file,
          previewUrl: URL.createObjectURL(file),
        });
      }

      if (overflowed) {
        toast.error(
          t("tooManyScreenshots", { max: PROBLEM_REPORT_MAX_SCREENSHOTS }),
        );
      }
      if (accepted.length === 0) return;

      const next = [...current, ...accepted];
      screenshotsRef.current = next;
      setScreenshots(next);
    },
    [t],
  );

  const removeScreenshot = useCallback((id: string) => {
    const target = screenshotsRef.current.find((shot) => shot.id === id);
    if (!target) return;
    URL.revokeObjectURL(target.previewUrl);
    const next = screenshotsRef.current.filter((shot) => shot.id !== id);
    screenshotsRef.current = next;
    setScreenshots(next);
  }, []);

  // Pasting a screenshot straight from the clipboard is how most people
  // actually attach one; the file picker is the fallback.
  const handlePaste = useCallback(
    (event: React.ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length === 0) return;
      event.preventDefault();
      addFiles(pasted);
    },
    [addFiles],
  );

  const resetForm = useCallback(() => {
    setDescription("");
    for (const shot of screenshotsRef.current) {
      URL.revokeObjectURL(shot.previewUrl);
    }
    screenshotsRef.current = [];
    setScreenshots([]);
  }, []);

  // Closing without submitting deliberately keeps the draft: a report is
  // usually half-assembled evidence, and a stray Escape should not bin it.
  const closeDialog = useCallback(() => {
    if (isListening) stopRecording();
    appStoreMutate({ openProblemReport: false });
  }, [appStoreMutate, isListening, stopRecording]);

  const canSubmit = description.trim().length > 0 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (isListening) stopRecording();
    setIsSubmitting(true);

    try {
      const uploaded: ProblemReportScreenshot[] = [];
      for (const shot of screenshots) {
        const result = await upload(shot.file);
        if (!result) {
          // `useFileUpload` has already toasted the reason.
          setIsSubmitting(false);
          return;
        }
        uploaded.push({
          key: result.pathname,
          url: result.url,
          name: shot.file.name,
          contentType: result.contentType ?? shot.file.type,
          size: result.size ?? shot.file.size,
        });
      }

      const response = await fetch("/api/problem-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          screenshots: uploaded,
          context: {
            pageUrl: window.location.href,
            userAgent: navigator.userAgent.slice(0, 512),
            locale,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
          },
        }),
      });

      if (!response.ok) throw new Error(`Request failed: ${response.status}`);

      resetForm();
      appStoreMutate({ openProblemReport: false });
    } catch (error) {
      console.error("Problem report submit failed:", error);
      toast.error(t("submitFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent className="md:max-w-lg" onPaste={handlePaste}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Textarea
              autoFocus
              value={description}
              maxLength={PROBLEM_REPORT_DESCRIPTION_MAX}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("placeholder")}
              className="min-h-36 resize-none pr-12"
              data-testid="problem-report-description"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  onClick={toggleListening}
                  aria-label={isListening ? t("stopDictation") : t("dictate")}
                  className={cn(
                    "absolute right-2 top-2 size-8 rounded-full transition-all duration-200",
                    isListening &&
                      "bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/50",
                  )}
                >
                  {isListening ? (
                    <Square className="size-3.5 fill-current animate-pulse" />
                  ) : (
                    <MicIcon className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isListening ? t("stopDictation") : t("dictate")}
              </TooltipContent>
            </Tooltip>
          </div>

          {screenshots.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {screenshots.map((shot) => (
                <div
                  key={shot.id}
                  className="relative size-20 rounded-md overflow-hidden border border-border"
                >
                  {/* Local object URL, so next/image would only add a proxy hop. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.previewUrl}
                    alt={shot.file.name}
                    className="size-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeScreenshot(shot.id)}
                    aria-label={t("removeScreenshot", { name: shot.file.name })}
                    className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5 hover:bg-background"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                // Reset so re-picking the same file fires onChange again.
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={screenshots.length >= PROBLEM_REPORT_MAX_SCREENSHOTS}
            >
              <ImagePlus className="size-4" />
              {t("addScreenshot")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("pasteHint")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={closeDialog}>
            {t("cancel")}
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            data-testid="problem-report-submit"
          >
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {t("submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
