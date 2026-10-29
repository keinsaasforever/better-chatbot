import { appStore } from "@/app/store";
import { FileArtifactChip } from "@/components/artifact-panel/file-artifact-chip";
import { ArtifactFileCard } from "@/components/tool-invocation/artifact-file-card";
import { useCopy } from "@/hooks/use-copy";
import { ToolUIPart } from "ai";
import { splitArtifactsForPanel } from "lib/code-runner/artifact-media";

import { callCodeRunWorker } from "lib/code-runner/call-worker";
import { INTERACTIVE_EXECUTION_TIMEOUT_MS } from "lib/code-runner/timeouts";

import {
  CodeRunnerResult,
  LogEntry,
} from "lib/code-runner/code-runner.interface";
import {
  errorToCodeRunnerResult,
  toCodeToolOutput,
} from "lib/code-runner/tool-output";
import { cn, isString, toAny } from "lib/utils";
import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRight,
  CopyIcon,
  Loader,
  Percent,
  PlayIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { safe } from "ts-safe";

import { CodeBlock } from "ui/CodeBlock";
import { Skeleton } from "ui/skeleton";
import { TextShimmer } from "ui/text-shimmer";

/**
 * Tool calls this tab has already started running, keyed by `toolCallId`.
 *
 * The guard cannot live in a ref, because a ref dies with the mount and this
 * component is unmounted by things outside its control: a resume that drops
 * the message carrying it, or any throw in the tree. The remount would then
 * re-run the same call in a second sandbox. `isInterruptedAssistantTail` and
 * the segment error boundary both narrow when that happens; this makes the
 * re-run impossible rather than merely unlikely.
 *
 * Module scope survives a remount and is discarded on a real page load, which
 * is exactly when re-running a still-unanswered call is the recovery we want.
 */
const startedToolCallIds = new Set<string>();

export const CodeExecutor = memo(function CodeExecutor({
  part,
  onResult,
  threadId,
  type,
}: {
  part: ToolUIPart;
  onResult?: (result?: any) => void;
  threadId?: string;
  type: "javascript" | "python";
}) {
  // The parent chat owns the authoritative id even when it is embedded outside
  // `/chat/[thread]`; the server uses it to stage that chat's attachments.
  // The agent selected for this thread is sent alongside so its bound files are
  // staged too — the server re-checks access, so this is a hint, not a grant.
  const agentId = appStore((state) =>
    threadId
      ? state.threadMentions[threadId]?.find(
          (mention) => mention.type === "agent",
        )?.agentId
      : undefined,
  );
  const { copy, copied } = useCopy();
  const t = useTranslations("Chat.Tool");
  const [isExecuting, setIsExecuting] = useState(false);
  // Collapsed by default so a run is one quiet row in the thread; the full
  // widget (code, logs, artifacts) is one click away. The component stays
  // mounted while collapsed, so the mount-time execution effect still fires.
  const [expanded, setExpanded] = useState(false);

  // Full execution result kept client-side for display (logs with images,
  // downloadable artifacts). The copy sent to the server via onResult is
  // truncated/stripped so large payloads never reach the model or DB.
  const [localResult, setLocalResult] = useState<CodeRunnerResult | null>(null);

  const lastStartedAt = useRef<number>(Date.now());

  const [realtimeLogs, setRealtimeLogs] = useState<
    (CodeRunnerResult["logs"][number] & { time: number })[]
  >([]);

  const codeResultContainerRef = useRef<HTMLDivElement>(null);

  const runCode = useCallback(
    async (code: string, type: "javascript" | "python") => {
      lastStartedAt.current = Date.now();
      const result = await callCodeRunWorker(type, {
        code,
        timeout: INTERACTIVE_EXECUTION_TIMEOUT_MS,
        threadId,
        agentId,
        onLog: (log) => {
          setRealtimeLogs((prev) => [...prev, { ...log, time: Date.now() }]);
        },
      });
      return result;
    },
    [threadId, agentId],
  );

  const menualToolCall = useCallback(
    async (code: string) => {
      // A throw here used to skip onResult entirely, leaving the tool call
      // unanswered forever — the chat loop waits on a result that never
      // arrives, and the started-call guard has already latched so nothing
      // retries. Report the failure as a result instead; the model can read it
      // and react.
      let result: CodeRunnerResult;
      try {
        result = await runCode(code, type);
      } catch (error) {
        result = errorToCodeRunnerResult(error);
      }
      setLocalResult(result);
      onResult?.(toAny(toCodeToolOutput(result)));
    },
    [onResult, runCode, type],
  );
  const isRunning = useMemo(() => {
    return isExecuting || part.state.startsWith("input");
  }, [isExecuting, part.state]);

  const scrollToCode = useCallback(() => {
    codeResultContainerRef.current?.scrollTo({
      top: codeResultContainerRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, []);

  const result = useMemo(() => {
    if (localResult) return localResult;
    if (part.state.startsWith("input")) return null;
    return part.output as CodeRunnerResult;
  }, [part, localResult]);

  // PDFs and images open in the artifact panel; everything else is a card
  // with a Download button. Both sit outside the collapsed log panel: the old
  // download chip lived inside it, so a user could ask for an Excel file, get
  // one, and never see it.
  const { files: panelFiles, downloads: downloadableArtifacts } = useMemo(
    () => splitArtifactsForPanel(result?.artifacts ?? []),
    [result],
  );

  const logs = useMemo(() => {
    const error = result?.error;
    // Copy the source array — never mutate `realtimeLogs` (state) or
    // `result.logs` (persisted). This memo re-runs on every render; pushing onto
    // the live array appended a duplicate error line each time (rendering the
    // same exception 10+ times). The copy makes the error render exactly once.
    const logs: (LogEntry & { time?: number })[] = [
      ...(realtimeLogs.length ? realtimeLogs : (result?.logs ?? [])),
    ];

    if (error) {
      logs.push({
        type: "error",
        args: [{ type: "data", value: error }],
        time: lastStartedAt.current,
      });
    }

    return logs.map((log, i) => {
      return (
        <div
          key={i}
          className={cn(
            "flex gap-1 text-muted-foreground pl-3",
            log.type == "error" && "text-destructive",
            log.type == "warn" && "text-yellow-500",
          )}
        >
          <div className="w-[8.6rem] hidden md:block">
            {new Date(toAny(log).time || Date.now()).toISOString()}
          </div>
          <div className="h-[15px] flex items-center">
            {log.type == "error" ? (
              <AlertTriangleIcon className="size-2" />
            ) : log.type == "warn" ? (
              <AlertTriangleIcon className="size-2" />
            ) : (
              <ChevronRight className="size-2" />
            )}
          </div>
          <div className="flex-1 min-w-0 whitespace-pre-wrap gap-1">
            {log.args.map((arg, i) => {
              if (arg.type == "image") {
                /* eslint-disable-next-line @next/next/no-img-element */
                return <img key={i} src={arg.value} alt="Code output" />;
              }
              return (
                <span key={i}>
                  {isString(arg?.value)
                    ? arg.value.toString()
                    : JSON.stringify(arg.value ?? arg)}
                </span>
              );
            })}
          </div>
        </div>
      );
    });
  }, [part, realtimeLogs, result]);

  const reExecute = useCallback(async () => {
    if (isExecuting) return;
    setIsExecuting(true);
    setRealtimeLogs([
      {
        type: "log",
        args: [{ type: "data", value: "Re-executing code..." }],
        time: Date.now(),
      },
    ]);
    const code = toAny(part.input)?.code;

    safe(() => runCode(code, type))
      .ifOk((result) => {
        setLocalResult(result);
        setRealtimeLogs([]);
      })
      .watch(() => setIsExecuting(false));
  }, [part.input, isExecuting, runCode, type]);

  const backendLabel = useMemo(() => {
    if (!result?.backend) return null;
    const lang =
      type == "python" ? "Python" : type == "javascript" ? "JS" : ">_";
    const where = result.backend === "e2b" ? "E2B" : "Browser";
    return `${lang} · ${where}`;
  }, [result?.backend, type]);

  const header = useMemo(() => {
    if (isRunning)
      return (
        <>
          <Loader className="size-3 animate-spin text-muted-foreground" />
          <TextShimmer className="text-xs">{t("codeGenerating")}</TextShimmer>
        </>
      );
    return (
      <>
        {result?.error ? (
          <>
            <AlertTriangleIcon className="size-3 text-destructive" />
            <span className="text-destructive text-xs uppercase">
              {t("codeError")}
            </span>
          </>
        ) : (
          <div className="text-[7px] bg-input rounded-xs w-4 h-4 p-0.5 flex items-end justify-end font-bold">
            {type == "javascript" ? "JS" : type == "python" ? "PY" : ">_"}
          </div>
        )}
        {backendLabel && (
          <span className="text-[10px] text-muted-foreground font-medium">
            {backendLabel}
          </span>
        )}
      </>
    );
  }, [part.state, result, isRunning, backendLabel, t]);

  const fallback = useMemo(() => {
    return <CodeFallback />;
  }, []);

  const logContainer = useMemo(() => {
    if (!logs.length) return null;
    return (
      <div className="p-4 text-[10px] text-foreground flex flex-col gap-1 border-t">
        <div className="text-foreground flex items-center gap-1">
          {isRunning ? (
            <Loader className="size-2 animate-spin" />
          ) : (
            <div className="w-1 h-1 mr-1 ring ring-border rounded-full" />
          )}
          keinsaas-navigator
          <Percent className="size-2" />
        </div>
        {logs}
        {isRunning && (
          <div className="ml-3 animate-caret-blink text-muted-foreground">
            |
          </div>
        )}
      </div>
    );
  }, [logs, isRunning]);

  useEffect(() => {
    if (
      onResult &&
      part.input &&
      part.state == "input-available" &&
      !startedToolCallIds.has(part.toolCallId)
    ) {
      startedToolCallIds.add(part.toolCallId);
      menualToolCall(toAny(part.input)?.code);
    }
    // `part.input` is a dependency, not just a read: a part can mount already
    // at "input-available" with the input still arriving, and keying only on
    // `state` meant the effect never re-ran once it landed — the call then sat
    // unanswered forever.
  }, [part.state, part.input, part.toolCallId, !!onResult]);

  useEffect(() => {
    if (isRunning) {
      const closeKey = setInterval(scrollToCode, 300);
      return () => clearInterval(closeKey);
    } else if (
      part.state.startsWith("output") &&
      startedToolCallIds.has(part.toolCallId)
    ) {
      scrollToCode();
    }
  }, [isRunning]);

  const panelId = `code-exec-${part.toolCallId}`;
  const statusLabel = isRunning
    ? t("codeWorking")
    : result?.error
      ? t("codeError")
      : t("codeCompleted");

  return (
    <div className="flex flex-col px-6 py-3">
      {/* Compact summary row — collapsed by default, like other tool calls. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className="flex gap-2 items-center cursor-pointer group/title text-left"
      >
        <div className="p-1.5 text-primary bg-input/40 rounded">
          {isRunning ? (
            <Loader className="size-3.5 animate-spin" />
          ) : result?.error ? (
            <AlertTriangleIcon className="size-3.5 text-destructive" />
          ) : (
            <CheckIcon className="size-3.5" />
          )}
        </div>
        <span className="font-bold flex items-center gap-2">
          {isRunning ? <TextShimmer>{statusLabel}</TextShimmer> : statusLabel}
        </span>
        <ChevronRight className="size-3.5" />
        <span
          className={cn(
            "text-xs transition-colors duration-300",
            result?.error
              ? "text-destructive"
              : "text-muted-foreground group-hover/title:text-primary",
          )}
        >
          {backendLabel ?? (type === "python" ? "Python" : "JS")}
        </span>
        <div className="ml-auto group-hover/title:bg-input p-1.5 rounded transition-colors duration-300">
          <ChevronDownIcon
            className={cn(expanded && "rotate-180", "size-3.5")}
          />
        </div>
      </button>

      {panelFiles.length > 0 && (
        // Outside the `expanded` block on purpose: a file the user asked for
        // should not be hidden behind a disclosure toggle.
        <div className="pt-3 flex flex-col gap-2">
          {panelFiles.map((file, i) => (
            <FileArtifactChip
              key={`${file.filename}-${i}`}
              part={part}
              file={file}
              // Only the first file, and only for a run that just happened in
              // this session — `localResult` is null when the message comes
              // back from history.
              autoOpen={i === 0 && Boolean(localResult)}
            />
          ))}
        </div>
      )}

      {downloadableArtifacts.length > 0 && (
        <div className="flex flex-col gap-2 pt-3">
          {downloadableArtifacts.map((artifact, i) => (
            <ArtifactFileCard
              key={`${artifact.href ?? artifact.filename}-${i}`}
              artifact={artifact}
            />
          ))}
        </div>
      )}

      {expanded && (
        <div id={panelId} className="pt-3">
          <div className="border overflow-x-hidden relative rounded-lg shadow fade-in animate-in duration-500">
            <div className="py-2.5 bg-border px-4 flex items-center gap-1.5 z-10 min-h-[37px]">
              {header}
              <div className="flex-1" />

              {part.state.startsWith("output") && (
                <>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground px-2 py-1 transition-all rounded-sm cursor-pointer hover:bg-input hover:text-foreground font-semibold"
                    onClick={reExecute}
                  >
                    <PlayIcon className="size-2" />
                    {t("run")}
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground px-2 py-1 transition-all rounded-sm cursor-pointer hover:bg-input hover:text-foreground font-semibold"
                    onClick={() => copy(toAny(part.input)?.code ?? "")}
                  >
                    {copied ? (
                      <CheckIcon className="size-2" />
                    ) : (
                      <CopyIcon className="size-2" />
                    )}
                    {t("copy")}
                  </button>
                </>
              )}
            </div>
            <div className="relative">
              <div className="absolute pointer-events-none top-0 left-0 w-full h-1/6 bg-gradient-to-b from-background to-transparent z-10" />
              <div className="absolute pointer-events-none bottom-0 left-0 w-full h-1/6 bg-gradient-to-t from-background to-transparent z-10" />
              <div className="absolute pointer-events-none top-0 left-0 w-1/6 h-full bg-gradient-to-r from-background to-transparent z-10" />
              <div className="absolute pointer-events-none top-0 right-0 w-1/6 h-full bg-gradient-to-l from-background to-transparent z-10" />
              <div
                className="min-h-14 p-6 text-xs overflow-y-auto max-h-[40vh]"
                ref={codeResultContainerRef}
              >
                <CodeBlock
                  className="p-4 text-[10px] overflow-x-auto"
                  code={toAny(part.input)?.code}
                  lang={type}
                  fallback={fallback}
                />
              </div>
            </div>
            {logContainer}
          </div>
        </div>
      )}
    </div>
  );
});

function CodeFallback() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-3 w-1/6" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-3 w-1/4" />
    </div>
  );
}
