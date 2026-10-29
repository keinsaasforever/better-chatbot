"use client";

import { ToolUIPart } from "ai";
import type { ChatMetadata } from "app-types/chat";
import { DefaultToolName } from "lib/ai/tools";
import {
  type ArtifactFile,
  splitArtifactsForPanel,
} from "lib/code-runner/artifact-media";
import type { E2BArtifact } from "lib/code-runner/code-runner.interface";
import {
  SANDBOX_BROWSER_TIMEOUT_MS,
  type SandboxApiResponse,
  type SandboxDeploymentPhase,
  isSandboxApiResponse,
} from "lib/e2b/sandbox-contract";
import { toAny } from "lib/utils";
import {
  FileText,
  Globe,
  ListTodo,
  Loader,
  Monitor,
  RotateCw,
  Table2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "ui/button";
import { TextShimmer } from "ui/text-shimmer";
import { ArtifactType, useArtifactPanel } from "./artifact-panel-context";

interface ArtifactChipProps {
  part: ToolUIPart;
  toolName: string;
  onResult?: (result: unknown) => Promise<void> | void;
  chatStatus?: string;
  runStatus?: ChatMetadata["runStatus"];
  /** Scopes sandbox reuse so a thread keeps one preview across iterations. */
  threadId?: string;
}

const TERMINAL_RUN_STATUSES = new Set<ChatMetadata["runStatus"]>([
  "completed",
  "failed",
  "timed_out",
  "cancelled",
]);

const PHASE_LABELS: Record<SandboxDeploymentPhase, string> = {
  generating_code: "Generating sandbox code…",
  starting_sandbox: "Starting sandbox…",
  installing: "Installing dependencies…",
  checking_preview: "Checking preview…",
  ready: "Preview ready",
  failed: "Sandbox failed",
};

/**
 * The file a document tool produced, resolved for the panel.
 *
 * Reads `part.output` rather than component state so it survives a refresh:
 * the durable URL is what was persisted with the message.
 */
function firstFileFromOutput(
  output: Record<string, unknown> | null,
): ArtifactFile | undefined {
  const artifacts = (output as { artifacts?: unknown } | null)?.artifacts;
  if (!Array.isArray(artifacts)) return undefined;

  const [file] = splitArtifactsForPanel(
    artifacts.filter(
      (a): a is E2BArtifact =>
        typeof a === "object" && a !== null && "filename" in a,
    ),
  ).files;
  return file;
}

function artifactTypeFromToolName(toolName: string): ArtifactType {
  if (toolName === DefaultToolName.E2BSandbox) return "sandbox";
  if (toolName === DefaultToolName.EditDocument) return "document-edit";
  if (toolName === DefaultToolName.CreatePlan) return "plan";
  if (toolName === DefaultToolName.BrowserAutomation) return "browser";
  if (toolName === DefaultToolName.CreatePdf) return "file";
  return "tabular";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ArtifactChip({
  part,
  toolName,
  onResult,
  chatStatus,
  runStatus,
  threadId,
}: ArtifactChipProps) {
  const { open, updatePart, artifact, deployments, updateDeployment } =
    useArtifactPanel();
  const tBrowser = useTranslations("Chat.Browser");
  const type = artifactTypeFromToolName(toolName);
  const input = toAny(part.input) as Record<string, unknown> | null;
  const output = toAny(part.output) as Record<string, unknown> | null;
  const deployment = deployments[part.toolCallId];

  const isStreaming = part.state === "input-streaming";
  const isInputReady = part.state === "input-available";
  const hasOutput = part.state?.startsWith("output");

  const hasOpened = useRef(false);
  const hasDeployed = useRef(false);
  const lastResult = useRef<SandboxApiResponse | null>(null);
  const deployGeneration = useRef(0);

  // A file-producing tool carries its result in the output, not the input, so
  // the chip has nothing to show until the render finishes.
  const artifactFile = useMemo(
    () => (type === "file" ? firstFileFromOutput(output) : undefined),
    [type, output],
  );

  const title =
    type === "sandbox"
      ? ((input?.title as string) ?? "Sandbox")
      : type === "plan"
        ? ((input?.title as string) ?? "Plan")
        : type === "document-edit"
          ? "Document Edit"
          : type === "browser"
            ? "Browser"
            : type === "file"
              ? (artifactFile?.filename ??
                (input?.filename as string) ??
                "Document")
              : "Tabular Review";

  const setDeployment = useCallback(
    (next: SandboxApiResponse, syncError?: string) => {
      updateDeployment(part.toolCallId, { ...next, syncError });
    },
    [part.toolCallId, updateDeployment],
  );

  const submitResult = useCallback(
    async (result: SandboxApiResponse) => {
      lastResult.current = result;
      if (!onResult) return;
      try {
        await onResult(result);
        setDeployment(result);
      } catch (error) {
        setDeployment(result, errorMessage(error));
      }
    },
    [onResult, setDeployment],
  );

  const deploy = useCallback(async () => {
    if (type !== "sandbox" || !input) return;

    // Superseded sandboxes are paused server-side after the deploy succeeds
    // (see persistAndSupersede in api/sandbox). Doing it here instead would be
    // wrong: with per-thread reuse the older chips point at the *same*
    // sandbox this deploy is about to reuse, so a client-side sweep would
    // pause the box we are reconnecting to, and could land after the resume.
    const generation = ++deployGeneration.current;
    const requestId = crypto.randomUUID();
    const starting: SandboxApiResponse = {
      requestId,
      phase: "starting_sandbox",
      code: "sandbox_starting",
      retryable: true,
      template: input.template as string,
    };
    setDeployment(starting);

    const controller = new AbortController();
    const deadline = window.setTimeout(
      () => controller.abort(),
      SANDBOX_BROWSER_TIMEOUT_MS,
    );
    const phaseTimers = [
      window.setTimeout(() => {
        if (deployGeneration.current !== generation) return;
        setDeployment({
          ...starting,
          phase: input.has_additional_dependencies
            ? "installing"
            : "checking_preview",
          code: input.has_additional_dependencies
            ? "installing_dependencies"
            : "checking_preview",
        });
      }, 10_000),
      window.setTimeout(() => {
        if (
          deployGeneration.current !== generation ||
          !input.has_additional_dependencies
        ) {
          return;
        }
        setDeployment({
          ...starting,
          phase: "checking_preview",
          code: "checking_preview",
        });
      }, 70_000),
    ];

    try {
      const response = await fetch("/api/sandbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fragment: input,
          toolCallId: part.toolCallId,
          requestId,
          threadId,
        }),
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const parsed = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : null;
      const result: SandboxApiResponse = isSandboxApiResponse(parsed)
        ? parsed
        : {
            requestId,
            phase: "failed",
            failedPhase: "starting_sandbox",
            code: "invalid_server_response",
            retryable: true,
            error: `Sandbox deployment failed (HTTP ${response.status}) with a non-JSON response.`,
          };

      if (!response.ok || result.phase !== "ready" || !result.url) {
        const failed: SandboxApiResponse = {
          ...result,
          phase: "failed",
          error:
            result.error ??
            `Sandbox deployment failed (HTTP ${response.status}).`,
        };
        setDeployment(failed);
        await submitResult(failed);
        return;
      }

      setDeployment(result);
      await submitResult(result);
    } catch (error) {
      const timedOut =
        error instanceof DOMException && error.name === "AbortError";
      const failed: SandboxApiResponse = {
        requestId,
        phase: "failed",
        failedPhase: "starting_sandbox",
        code: timedOut ? "browser_timeout" : "sandbox_request_failed",
        retryable: true,
        error: timedOut
          ? "The browser stopped waiting after 180 seconds."
          : errorMessage(error),
        template: input.template as string,
      };
      setDeployment(failed);
      await submitResult(failed);
    } finally {
      window.clearTimeout(deadline);
      phaseTimers.forEach((timer) => window.clearTimeout(timer));
    }
  }, [input, part.toolCallId, setDeployment, submitResult, threadId, type]);

  const resumeChat = useCallback(async () => {
    const result = lastResult.current;
    if (!result) return;
    await submitResult(result);
  }, [submitResult]);

  useEffect(() => {
    if (artifact?.toolCallId === part.toolCallId) {
      updatePart(part.toolCallId, part);
    }
  }, [
    artifact?.toolCallId,
    part,
    part.output,
    part.state,
    part.toolCallId,
    updatePart,
  ]);

  useEffect(() => {
    if (!deployment && isSandboxApiResponse(output)) {
      updateDeployment(part.toolCallId, output);
    }
  }, [deployment, output, part.toolCallId, updateDeployment]);

  useEffect(() => {
    if (hasOpened.current) return;
    // A file chip has nothing to show until the render lands: its result is in
    // the output, so opening at mount would put an empty panel on screen and
    // latch `hasOpened` before the file ever arrived.
    if (type === "file" && !artifactFile) return;
    hasOpened.current = true;
    open({
      toolCallId: part.toolCallId,
      type,
      part,
      onResult,
      file: artifactFile,
    });
  }, [artifactFile, onResult, open, part, type]);

  useEffect(() => {
    if (type !== "sandbox" || !isStreaming) return;
    const terminalRun = runStatus && TERMINAL_RUN_STATUSES.has(runStatus);
    const terminalChat = chatStatus === "ready" || chatStatus === "error";
    const failInterruptedGeneration = () =>
      setDeployment({
        requestId: part.toolCallId,
        phase: "failed",
        failedPhase: "generating_code",
        code: "code_generation_interrupted",
        retryable: true,
        error: "Sandbox code generation was interrupted.",
      });

    if (terminalRun || terminalChat) {
      failInterruptedGeneration();
      return;
    }

    const deadline = window.setTimeout(
      failInterruptedGeneration,
      SANDBOX_BROWSER_TIMEOUT_MS,
    );
    return () => window.clearTimeout(deadline);
  }, [
    chatStatus,
    isStreaming,
    part.toolCallId,
    runStatus,
    setDeployment,
    type,
  ]);

  useEffect(() => {
    if (type !== "sandbox" || !isInputReady || hasDeployed.current || !input) {
      return;
    }
    hasDeployed.current = true;
    void deploy();
  }, [deploy, input, isInputReady, type]);

  const Icon =
    type === "sandbox"
      ? Monitor
      : type === "document-edit"
        ? FileText
        : type === "plan"
          ? ListTodo
          : type === "browser"
            ? Globe
            : type === "file"
              ? FileText
              : Table2;
  const phase = deployment?.phase ?? (isStreaming ? "generating_code" : null);
  // The browser tool streams its own status, so the chip reads that rather
  // than the part state — "Waiting for you" has to be visible from the message
  // list, or a parked run looks like a finished one.
  const browserStatus = type === "browser" ? (output?.status as string) : null;
  const browserLabel =
    browserStatus === "awaiting-user"
      ? tBrowser("statusAwaitingUser")
      : browserStatus === "blocked"
        ? tBrowser("statusBlocked")
        : browserStatus === "failed"
          ? tBrowser("statusFailed")
          : browserStatus === "done"
            ? tBrowser("statusDone")
            : browserStatus === "running"
              ? tBrowser("statusRunning")
              : tBrowser("statusStarting");
  const statusLabel =
    type === "sandbox" && phase
      ? deployment?.syncError
        ? "Preview ready — chat paused"
        : phase === "failed"
          ? `${deployment.error ?? "Sandbox failed"}`
          : PHASE_LABELS[phase]
      : type === "browser"
        ? browserLabel
        : isStreaming
          ? type === "document-edit"
            ? "Applying edits…"
            : type === "plan"
              ? "Drafting plan…"
              : type === "file"
                ? "Writing document…"
                : "Creating table…"
          : hasOutput && output?.error
            ? "Error — click to view"
            : hasOutput
              ? "Click to view"
              : "Opening…";
  const isBusy =
    type === "file"
      ? !hasOutput
      : type === "sandbox"
        ? phase !== "ready" && phase !== "failed"
        : type === "browser"
          ? browserStatus !== "done" &&
            browserStatus !== "failed" &&
            browserStatus !== "blocked" &&
            browserStatus !== "awaiting-user"
          : isStreaming;

  return (
    <div className="my-1 px-4">
      <div
        onClick={() =>
          open({
            toolCallId: part.toolCallId,
            type,
            part,
            onResult,
            file: artifactFile,
          })
        }
        className="py-2 pl-2 pr-4 w-full md:w-max flex items-center border rounded-xl select-none hover:bg-accent/30 dark:hover:bg-white/5 hover:cursor-pointer transition-colors gap-2"
      >
        <div className="rounded-lg w-9 h-9 bg-black/5 dark:bg-white/5 shrink-0 flex items-center justify-center">
          {isBusy ? (
            <Loader className="size-4 animate-spin text-muted-foreground" />
          ) : (
            <Icon className="size-4 text-orange-500" strokeWidth={2} />
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold font-sans text-sm text-primary truncate">
            {title}
          </span>
          <span className="font-sans text-xs text-muted-foreground max-w-80 truncate">
            {isBusy ? <TextShimmer>{statusLabel}</TextShimmer> : statusLabel}
          </span>
          {deployment?.requestId && (
            <span className="font-mono text-[10px] text-muted-foreground/70">
              Request {deployment.requestId}
            </span>
          )}
        </div>
        {deployment?.phase === "failed" &&
          deployment.retryable &&
          deployment.failedPhase !== "generating_code" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-2 h-7 gap-1"
              onClick={(event) => {
                event.stopPropagation();
                void deploy();
              }}
            >
              <RotateCw className="size-3" />
              Retry
            </Button>
          )}
        {deployment?.syncError && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-2 h-7"
            onClick={(event) => {
              event.stopPropagation();
              void resumeChat();
            }}
          >
            Resume chat
          </Button>
        )}
      </div>
    </div>
  );
}
