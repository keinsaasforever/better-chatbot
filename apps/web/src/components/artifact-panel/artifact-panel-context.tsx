"use client";

import { ToolUIPart } from "ai";
import type { ArtifactFile } from "lib/code-runner/artifact-media";
import type { SandboxDeploymentState } from "lib/e2b/sandbox-contract";
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

export type ArtifactType =
  | "sandbox"
  | "document-edit"
  | "tabular"
  | "plan"
  | "browser"
  | "file";

export interface ArtifactEntry {
  toolCallId: string;
  type: ArtifactType;
  /**
   * The tool call this entry came from. Absent for a file the user uploaded:
   * no tool produced it, and every panel branch that reads the part already
   * treats it as optional.
   */
  part?: ToolUIPart;
  /** Calls addToolResult to unblock the AI stream (sandbox only). */
  onResult?: (result: unknown) => Promise<void> | void;
  /** Required when `type` is "file": which file this entry shows. */
  file?: ArtifactFile;
}

/**
 * Identity of an open panel entry.
 *
 * One tool call can produce several files, so `toolCallId` alone is not unique
 * for file entries — a chip row would otherwise highlight every file in the
 * run as soon as one of them was opened.
 */
export function artifactEntryKey(
  entry: Pick<ArtifactEntry, "toolCallId" | "file">,
): string {
  return entry.file
    ? `${entry.toolCallId}:${entry.file.filename}`
    : entry.toolCallId;
}

interface ArtifactPanelCtx {
  artifact: ArtifactEntry | null;
  isOpen: boolean;
  open: (entry: ArtifactEntry) => void;
  close: () => void;
  /** Update the stored part in-place (e.g., after output arrives). */
  updatePart: (toolCallId: string, part: ToolUIPart) => void;
  deployment: SandboxDeploymentState | null;
  deployments: Record<string, SandboxDeploymentState>;
  updateDeployment: (
    toolCallId: string,
    deployment: SandboxDeploymentState,
  ) => void;
}

const ArtifactPanelContext = createContext<ArtifactPanelCtx>({
  artifact: null,
  isOpen: false,
  open: () => {},
  close: () => {},
  updatePart: () => {},
  deployment: null,
  deployments: {},
  updateDeployment: () => {},
});

export function ArtifactPanelProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [artifact, setArtifact] = useState<ArtifactEntry | null>(null);
  const [deployments, setDeployments] = useState<
    Record<string, SandboxDeploymentState>
  >({});

  const open = useCallback((entry: ArtifactEntry) => setArtifact(entry), []);
  const close = useCallback(() => setArtifact(null), []);
  const updatePart = useCallback(
    (toolCallId: string, part: ToolUIPart) =>
      setArtifact((prev) =>
        prev?.toolCallId === toolCallId ? { ...prev, part } : prev,
      ),
    [],
  );
  const updateDeployment = useCallback(
    (toolCallId: string, deployment: SandboxDeploymentState) => {
      setDeployments((current) => ({ ...current, [toolCallId]: deployment }));
    },
    [],
  );
  const deployment = artifact
    ? (deployments[artifact.toolCallId] ?? null)
    : null;

  const value = useMemo(
    () => ({
      artifact,
      isOpen: artifact !== null,
      open,
      close,
      updatePart,
      deployment,
      deployments,
      updateDeployment,
    }),
    [
      artifact,
      open,
      close,
      updatePart,
      deployment,
      deployments,
      updateDeployment,
    ],
  );

  return (
    <ArtifactPanelContext.Provider value={value}>
      {children}
    </ArtifactPanelContext.Provider>
  );
}

export function useArtifactPanel() {
  return useContext(ArtifactPanelContext);
}

export type { ArtifactFile };
