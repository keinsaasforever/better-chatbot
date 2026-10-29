"use client";

import React, { useState, useCallback, useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Mail, Pencil, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { markdownToHtmlEmail } from "@/lib/email/email-body-format";

export type EmailPreviewOutcome = "approved" | "rejected";

export type ApprovedEmailDraft = {
  to: string;
  subject: string;
  body: string;
};

interface EmailPreviewProps {
  to: string;
  subject: string;
  body: string;
  onApprove?: (draft: ApprovedEmailDraft) => void;
  onReject?: () => void;
  isLoading?: boolean;
  /**
   * Set once the tool call has a result. The card then renders read-only —
   * a settled draft is a record of what was sent, not something to edit.
   */
  outcome?: EmailPreviewOutcome;
}

/**
 * Deliberately permissive: the field is a last-line guard against an obvious
 * typo, not an address validator. Anything shaped like `local@domain.tld`
 * passes; deliverability is the mail server's answer to give.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * EmailPreviewUI Component
 *
 * Displays an email draft for user review before it is handed to an email
 * tool. The draft arrives as markdown-flavoured text, which no mail client
 * renders — so the card shows the *rendered* body by default and keeps the
 * raw text behind an explicit Edit toggle.
 *
 * Features:
 * - Rendered preview matching what the recipient will see
 * - Editable recipient, subject and body
 * - Approve & Send / Reject
 * - Loading state during generation
 * - Read-only completed state after approval/rejection
 */
export function EmailPreviewUI({
  to: initialTo,
  subject: initialSubject,
  body: initialBody,
  onApprove,
  onReject,
  isLoading = false,
  outcome,
}: EmailPreviewProps) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [isRejected, setIsRejected] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const recipientIsValid = EMAIL_RE.test(to.trim());

  const handleApprove = useCallback(() => {
    setIsConfirmed(true);
    onApprove?.({ to: to.trim(), subject, body });
  }, [to, subject, body, onApprove]);

  const handleReject = useCallback(() => {
    setIsRejected(true);
    onReject?.();
  }, [onReject]);

  const isCompleted = Boolean(outcome) || isConfirmed || isRejected;
  const approved = outcome ? outcome === "approved" : isConfirmed;
  const rejected = outcome ? outcome === "rejected" : isRejected;
  const isEditable = isEditing && !isCompleted && !isLoading;
  const fieldId = useId();
  const t = useTranslations("Chat.Hitl.email");

  const renderedBody = useMemo(() => markdownToHtmlEmail(body), [body]);

  const headerStatus = isCompleted
    ? {
        Icon: approved ? CheckCircle2 : AlertCircle,
        label: approved ? t("approvedBadge") : t("rejectedBadge"),
        className: approved ? "text-emerald-600" : "text-red-600",
      }
    : null;

  return (
    <div
      className={cn(
        "my-3 overflow-hidden rounded-lg border bg-background shadow-sm",
        rejected ? "border-destructive" : "border-border",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Mail className="h-3.5 w-3.5" aria-hidden />
        {t("title")}
        {headerStatus && (
          <span
            className={cn(
              "ml-auto flex items-center gap-1 text-xs font-semibold",
              headerStatus.className,
            )}
          >
            <headerStatus.Icon className="h-4 w-4" aria-hidden />
            {headerStatus.label}
          </span>
        )}
      </div>

      {/* Email Details */}
      <div className="divide-y divide-border text-sm text-foreground">
        {/* To Field */}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <label
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            htmlFor={`${fieldId}-to`}
          >
            {t("to")}
          </label>
          {isEditable ? (
            <input
              id={`${fieldId}-to`}
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={!recipientIsValid}
              className={cn(
                "ml-4 flex-1 rounded border bg-background p-1.5 text-right text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                recipientIsValid
                  ? "border-input focus:border-ring"
                  : "border-destructive",
              )}
              placeholder={t("toPlaceholder")}
            />
          ) : (
            <span
              id={`${fieldId}-to`}
              className="ml-4 flex-1 break-words text-right text-foreground"
            >
              {to}
            </span>
          )}
        </div>

        {/* Subject Field */}
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <label
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            htmlFor={`${fieldId}-subject`}
          >
            {t("subject")}
          </label>
          {isEditable ? (
            <input
              id={`${fieldId}-subject`}
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="ml-4 flex-1 rounded border border-input bg-background p-1.5 text-right text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              placeholder={t("subjectPlaceholder")}
            />
          ) : (
            <span
              id={`${fieldId}-subject`}
              className="ml-4 flex-1 break-words text-right text-foreground"
            >
              {subject}
            </span>
          )}
        </div>

        {/* Body Field */}
        <div className="px-4 py-4">
          {isLoading ? (
            <div className="space-y-2" aria-live="polite" aria-busy="true">
              <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
              <span className="sr-only">{t("generating")}</span>
            </div>
          ) : isEditable ? (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full resize-none whitespace-pre-wrap rounded border border-input bg-background p-2 text-sm leading-relaxed text-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              rows={Math.min(body.split("\n").length + 1, 15)}
              placeholder={t("bodyPlaceholder")}
              autoFocus
            />
          ) : (
            // Safe: markdownToHtmlEmail escapes the draft before it adds any
            // markup, and only emits inline-styled block/emphasis tags.
            <div
              className="email-preview-body text-sm leading-relaxed text-foreground [&_a]:underline [&_li]:list-disc [&_ol_li]:list-decimal [&_p:last-child]:mb-0"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: content is escaped in markdownToHtmlEmail
              dangerouslySetInnerHTML={{ __html: renderedBody }}
            />
          )}
        </div>
      </div>

      {/* Action Buttons */}
      {!isCompleted && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mr-auto"
            onClick={() => setIsEditing((editing) => !editing)}
            disabled={isLoading}
          >
            {isEditing ? (
              <>
                <Eye className="h-3.5 w-3.5" aria-hidden />
                {t("preview")}
              </>
            ) : (
              <>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                {t("edit")}
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleReject}
            disabled={isLoading}
          >
            {t("reject")}
          </Button>
          <Button
            type="button"
            onClick={handleApprove}
            disabled={isLoading || !recipientIsValid}
            title={recipientIsValid ? undefined : t("invalidRecipient")}
          >
            {t("approve")}
          </Button>
        </div>
      )}
    </div>
  );
}
