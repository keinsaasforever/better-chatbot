"use client";

import { ToolUIPart } from "ai";
import type { ArtifactFile } from "lib/code-runner/artifact-media";
import { cn, formatBytes } from "lib/utils";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { artifactEntryKey, useArtifactPanel } from "./artifact-panel-context";
import { iconForFile } from "./file-kind-icon";

interface FileArtifactChipProps {
  part: ToolUIPart;
  file: ArtifactFile;
  /**
   * Open the panel on mount. Set for the first file of a run that just
   * happened, so a user who asked for a PDF sees it without hunting; never set
   * when the message is rehydrated from history, which would otherwise pop a
   * panel open on every page load of an old thread.
   */
  autoOpen?: boolean;
}

/**
 * A generated file, as a chip that opens it in the artifact panel.
 *
 * Unlike `ArtifactChip` this is data-driven rather than keyed off a tool name:
 * one tool call can produce several files, and each gets its own chip and its
 * own panel entry.
 */
export function FileArtifactChip({
  part,
  file,
  autoOpen,
}: FileArtifactChipProps) {
  const { open, artifact } = useArtifactPanel();
  const t = useTranslations("Chat.Artifact");
  const hasAutoOpened = useRef(false);

  const entry = {
    toolCallId: part.toolCallId,
    type: "file" as const,
    part,
    file,
  };
  const isOpen =
    artifact != null && artifactEntryKey(artifact) === artifactEntryKey(entry);

  useEffect(() => {
    if (!autoOpen || hasAutoOpened.current) return;
    hasAutoOpened.current = true;
    open(entry);
    // Mount-time only: `entry` is rebuilt every render, and re-running this on
    // its identity would reopen the panel the user just closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  const Icon = iconForFile(file);

  return (
    <button
      type="button"
      onClick={() => open(entry)}
      className={cn(
        "py-2 pl-2 pr-4 w-full md:w-max flex items-center border rounded-xl select-none text-left hover:bg-accent/30 dark:hover:bg-white/5 hover:cursor-pointer transition-colors gap-2",
        isOpen && "bg-accent/30 dark:bg-white/5",
      )}
    >
      <div className="rounded-lg w-9 h-9 bg-black/5 dark:bg-white/5 shrink-0 flex items-center justify-center">
        <Icon className="size-4 text-orange-500" strokeWidth={2} />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="font-semibold font-sans text-sm text-primary truncate">
          {file.filename}
        </span>
        <span className="font-sans text-xs text-muted-foreground max-w-80 truncate">
          {file.sizeBytes
            ? `${formatBytes(file.sizeBytes)} · ${t("fileReady")}`
            : t("fileReady")}
        </span>
      </div>
    </button>
  );
}
