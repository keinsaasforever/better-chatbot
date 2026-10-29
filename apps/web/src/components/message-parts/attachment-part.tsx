"use client";

import {
  attachmentToArtifactFile,
  canPreviewInPanel,
} from "lib/code-runner/artifact-media";
import { cn } from "lib/utils";
import { useTranslations } from "next-intl";
import {
  artifactEntryKey,
  useArtifactPanel,
} from "../artifact-panel/artifact-panel-context";
import { iconForFile } from "../artifact-panel/file-kind-icon";
import { SourceUrlMessagePart } from "./source-url-part";

/**
 * An uploaded file in the transcript, as a chip that opens the artifact panel.
 *
 * Uploads used to render as a bare link to the raw bucket URL: no preview, and
 * a download that depended on the attachments bucket being public — which the
 * storage layer itself describes as private — and that the desktop shell sent
 * to the system browser because the host is not the app's origin.
 *
 * Nothing new is stored to fix that. The attachment is adapted into the same
 * `ArtifactFile` a generated file uses, which routes its download through
 * `/api/storage/download` (owner-checked, never expiring, and matched by the
 * desktop Save-As handler) and lets it reuse the panel that already exists.
 *
 * A file that is not one of our storage objects — a pasted link, a data: URI —
 * falls through to the old card, which is the right thing for something we
 * cannot fetch, preview or vouch for.
 */
export function AttachmentMessagePart({
  part,
  isUserMessage,
  messageId,
  readonly,
}: {
  part: { type: "source-url"; url: string; title?: string; mediaType?: string };
  isUserMessage: boolean;
  messageId: string;
  /**
   * A shared or exported transcript. The viewer is not the owner, so the
   * download route would refuse them and the preview routes with it: the chip
   * shows what the file was and offers nothing it cannot deliver.
   */
  readonly?: boolean;
}) {
  const t = useTranslations("Chat.Artifact");
  const { open, artifact } = useArtifactPanel();

  const file = attachmentToArtifactFile({
    url: part.url,
    filename: part.title,
    mediaType: part.mediaType,
  });

  if (!file) {
    return <SourceUrlMessagePart part={part} isUserMessage={isUserMessage} />;
  }

  const Icon = iconForFile(file);

  // The storage key is stable across re-renders and across a reload, which
  // `title` and array position are not.
  const entry = {
    toolCallId: `${messageId}:${file.url}`,
    type: "file" as const,
    file,
  };
  const isOpen =
    artifact != null && artifactEntryKey(artifact) === artifactEntryKey(entry);

  const label = canPreviewInPanel(file)
    ? t("attachmentOpen")
    : t("attachmentDownload");

  const body = (
    <>
      <div className="rounded-lg w-9 h-9 bg-black/5 dark:bg-white/5 shrink-0 flex items-center justify-center">
        <Icon className="size-4 text-orange-500" strokeWidth={2} />
      </div>
      <div className="flex flex-col min-w-0 text-left">
        <span className="font-semibold font-sans text-sm text-primary truncate">
          {file.filename}
        </span>
        <span className="font-sans text-xs text-muted-foreground max-w-80 truncate">
          {readonly ? t("attachmentSharedNotice") : label}
        </span>
      </div>
    </>
  );

  const shell = cn(
    "py-2 pl-2 pr-4 w-full md:w-max flex items-center border rounded-xl select-none gap-2 transition-colors",
    isUserMessage ? "ml-auto" : "mr-auto",
  );

  if (readonly) {
    return <div className={shell}>{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => open(entry)}
      className={cn(
        shell,
        "hover:bg-accent/30 dark:hover:bg-white/5 hover:cursor-pointer",
        isOpen && "bg-accent/30 dark:bg-white/5",
      )}
    >
      {body}
    </button>
  );
}
