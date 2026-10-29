"use client";

import { appStore } from "@/app/store";
import type { ThreadImageMask } from "@/app/store";
import { useAgentAlertNotifications } from "@/hooks/use-agent-alert-notifications";
import { useChatCore } from "@/hooks/use-chat-core";
import { useGlobalShortcut } from "@/hooks/use-global-shortcut";
import { useScrollAnchor } from "@/hooks/use-scroll-anchor";
import { useStableThreadId } from "@/hooks/use-stable-thread-id";
import { analytics } from "@/lib/analytics/posthog";
import { requireCredits } from "@/lib/billing/require-credits";
import { recordBootEvent } from "@/lib/boot-diagnostics/client";
import clsx from "clsx";
import { cn, createDebounce, generateUUID, truncateString } from "lib/utils";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChatGreeting } from "./chat-greeting";
import { ChatMessageList } from "./chat-message-list";
import { ErrorMessage } from "./message";
import PromptInput from "./prompt-input";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { WorkspaceModeToggle } from "./workspace-mode-toggle";

import { useShallow } from "zustand/shallow";

import type { AgentKnowledgeBaseBinding } from "app-types/agent";

import type { UseChatHelpers } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  TextUIPart,
  UIMessage,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";

import {
  createThreadWithProjectAction,
  deleteThreadAction,
  loadOlderThreadMessagesAction,
} from "@/app/api/chat/actions";
import { useGenerateThreadTitle } from "@/hooks/queries/use-generate-thread-title";
import { useFileDragOverlay } from "@/hooks/use-file-drag-overlay";
import { useToRef } from "@/hooks/use-latest";
import { useMounted } from "@/hooks/use-mounted";
import { type RecoveryState, useRunRecovery } from "@/hooks/use-run-recovery";
import { useThreadFileUploader } from "@/hooks/use-thread-file-uploader";
import {
  hasDefaultToolMention,
  hasMcpMention,
} from "@/lib/chat/mention-tool-scope";
import {
  buildAnsweredInChatOutput,
  extractSendMessageText,
  findPendingToolCall,
} from "@/lib/chat/pending-tool-call";
import { latestAgentIdFromMessages } from "@/lib/chat/latest-agent-id";
import { isProjectDraftThreadId } from "@/lib/chat/project-draft-thread";
import { isInterruptedAssistantTail } from "@/lib/chat/resumable-message";
import { extractTitleSeedFromSendMessage } from "@/lib/chat/thread-title";
import {
  ChatApiSchemaRequestBody,
  ChatAttachment,
  ChatMention,
  ChatMetadata,
  ChatModel,
} from "app-types/chat";
import { AnimatePresence, motion } from "framer-motion";
import { resolveAllowedAppDefaultToolkits } from "lib/ai/tools/resolve-allowed-toolkits";
import { getStorageManager } from "lib/browser-storage";
import { tailReservePx } from "lib/chat-tail-reserve";
import { CHAT_MESSAGE_WINDOW } from "lib/const";
import { Shortcuts, isShortcutEvent } from "lib/keyboard-shortcuts";
import { FilePlus, Loader } from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { mutate } from "swr";
import { safe } from "ts-safe";
import { Button } from "ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "ui/dialog";
import { Think } from "ui/think";
import { ArtifactPanel } from "./artifact-panel/artifact-panel";
import {
  ArtifactPanelProvider,
  useArtifactPanel,
} from "./artifact-panel/artifact-panel-context";

type Props = {
  /**
   * Omit on routes that just need a throwaway thread (the `/` home page). The
   * id is then minted once on the client and stays put, so a server re-render
   * cannot swap it out mid-session. Routes that own a real thread pass it.
   */
  threadId?: string;
  initialMessages: Array<UIMessage>;
  selectedChatModel?: string;
  projectInfo?: {
    id: string;
    name: string;
  };
  /** When true, first send navigates to /chat/[threadId] (project embed widget). */
  navigateOnSend?: boolean;
  /** Create a DB thread on first send instead of using threadId immediately. */
  createProjectThreadOnSend?: string;
  /** Hide project badge in embed; full chat page keeps it visible. */
  showProjectContextBadge?: boolean;
  /** Light rays / particles background (off for embedded project chat). */
  showDecorations?: boolean;
  /** Keep page at top on project embed; do not autofocus chat input. */
  autoFocusInput?: boolean;
  /** Compact full-width layout for project page embed. */
  embedded?: boolean;
  /** Called with the new thread ID when a project thread is created on first send. */
  onThreadCreated?: (threadId: string) => void;
  initialThread?: {
    title?: string;
    projectId?: string;
    /** Knowledge sources stored on the thread, restored into the composer. */
    knowledgeBases?: AgentKnowledgeBaseBinding[];
  };
};

const LightRays = dynamic(() => import("ui/light-rays"), {
  ssr: false,
});

const Particles = dynamic(() => import("ui/particles"), {
  ssr: false,
});

/**
 * Breathing room kept between the newest content and the composer.
 *
 * The composer wrapper is anchored to the bottom edge and carries its own
 * padding, so its measured height already covers the fade above it — this is
 * only the extra gap the tail reserve leaves on top.
 */
const COMPOSER_GAP_PX = 8;

const firstTimeStorage = getStorageManager("IS_FIRST");
const isFirstTime = firstTimeStorage.get() ?? true;
firstTimeStorage.set(false);

/**
 * Hands the composer's brush mask to exactly one request. Returns undefined
 * when there is none, so the request body stays byte-identical to before for
 * every turn without a mask.
 */
function takeThreadImageMask(threadId: string): ThreadImageMask | undefined {
  const mask = appStore.getState().threadImageMask[threadId];
  if (!mask) return undefined;
  appStore.getState().mutate((prev) => {
    const { [threadId]: _consumed, ...rest } = prev.threadImageMask;
    return { threadImageMask: rest };
  });
  return mask;
}

export default function ChatBot({
  threadId: threadIdProp,
  initialMessages,
  projectInfo,
  navigateOnSend = false,
  createProjectThreadOnSend,
  showProjectContextBadge = true,
  showDecorations = true,
  autoFocusInput = true,
  embedded = false,
  onThreadCreated,
  initialThread,
}: Props) {
  const threadId = useStableThreadId(threadIdProp);
  const isDraftThread = isProjectDraftThreadId(threadId);
  const router = useRouter();

  useEffect(() => {
    recordBootEvent("chatbot-mount", { threadId });
    return () => recordBootEvent("chatbot-unmount", { threadId });
  }, [threadId]);

  const {
    containerRef,
    isAtBottom,
    handleScroll: handleScrollAnchor,
    scrollToBottom,
  } = useScrollAnchor();
  const { uploadFiles } = useThreadFileUploader(threadId);
  const handleFileDrop = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      await uploadFiles(files);
    },
    [uploadFiles],
  );
  const { isDragging } = useFileDragOverlay({
    onDropFiles: handleFileDrop,
  });

  const [
    appStoreMutate,
    model,
    autoRouting,
    toolChoice,
    planMode,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    threadMentions,
    pendingThreadMention,
    threadImageToolModel,
  ] = appStore(
    // threadList is intentionally NOT selected here: it changes as the sidebar
    // and other threads update, but this component only reads it inside
    // callbacks (via appStore.getState()), never in render. Subscribing to it
    // would re-render the whole chat on unrelated thread-list churn.
    useShallow((state) => [
      state.mutate,
      state.chatModel,
      state.autoRouting,
      state.toolChoice,
      state.planMode,
      state.allowedAppDefaultToolkit,
      state.allowedMcpServers,
      state.threadMentions,
      state.pendingThreadMention,
      state.threadImageToolModel,
    ]),
  );

  const generateTitle = useGenerateThreadTitle({
    threadId,
  });

  const [showParticles, setShowParticles] = useState(
    showDecorations && isFirstTime,
  );

  const onFinish = useCallback(() => {
    const messages = latestRef.current.messages;
    const threadList = appStore.getState().threadList;
    const prevThread = threadList.find((v) => v.id === threadId);
    const isNewThread =
      !prevThread?.title?.trim() &&
      messages.filter((v) => v.role === "user" || v.role === "assistant")
        .length < 3;
    if (isNewThread) {
      const part = messages
        .slice(0, 2)
        .flatMap((m) =>
          m.parts
            .filter((v) => v.type === "text")
            .map(
              (p) =>
                `${m.role}: ${truncateString((p as TextUIPart).text, 500)}`,
            ),
        );
      if (part.length > 0) {
        generateTitle(part.join("\n\n"));
      }

      // Track chat message sent (first message of new thread)
      const lastUserMessage = messages
        .filter((m) => m.role === "user")
        .slice(-1)[0];
      if (lastUserMessage) {
        const textContent = lastUserMessage.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as TextUIPart).text)
          .join(" ");
        const hasAttachments = lastUserMessage.parts.some(
          (p) => (p as any).type === "file" || (p as any).type === "source-url",
        );
        const attachmentCount = lastUserMessage.parts.filter(
          (p) => (p as any).type === "file" || (p as any).type === "source-url",
        ).length;

        analytics.chatMessageSent({
          threadId,
          modelId: latestRef.current.model
            ? `${latestRef.current.model.provider}/${latestRef.current.model.model}`
            : undefined,
          hasAttachments,
          attachmentCount,
          characterCount: textContent.length,
        });
      }
    } else if (threadList[0]?.id !== threadId) {
      mutate("/api/thread");
    }

    // Clear image tool model after message completes
    // This allows generating multiple images in the same chat
    if (latestRef.current.threadImageToolModel[threadId]) {
      appStoreMutate((prev) => {
        const newImageToolModel = { ...prev.threadImageToolModel };
        delete newImageToolModel[threadId];
        return { threadImageToolModel: newImageToolModel };
      });
    }
  }, [threadId, appStoreMutate, generateTitle]);

  const [input, setInput] = useState("");

  // Set when the user hits stop with a pending tool call. Blocks the automatic
  // tool-result resend below so a stopped run does not immediately re-fire; it
  // is cleared on the next send / tool result.
  const stoppedRef = useRef(false);

  // The tool call currently waiting on the UI (plan approval, input request,
  // manual confirmation). Kept in a ref so a send can settle it before the new
  // user turn goes out — see handleSendMessage.
  const pendingToolCallRef = useRef<{
    toolName: string;
    toolCallId: string;
  } | null>(null);

  const {
    messages,
    status,
    setMessages,
    addToolResult: _addToolResult,
    addToolApprovalResponse: _addToolApprovalResponse,
    error,
    sendMessage,
    stop,
    regenerate,
    clearError,
    resumeStream,
  } = useChatCore({
    id: threadId,
    // Stream resumption is handled by the threadId-keyed effect below, NOT via
    // the `resume` option — setting both would call resumeStream() twice on
    // mount, and concurrent resumes duplicate the assistant message (makeRequest
    // has no concurrency guard; each call builds its own message copy).
    // Opt out of the shared onError rollback: this chat is persisted
    // server-side, so it keeps the failed message for ErrorMessage retry.
    onError: undefined,
    sendAutomaticallyWhen: (options) =>
      !stoppedRef.current &&
      lastAssistantMessageIsCompleteWithToolCalls(options),
    transport: new DefaultChatTransport({
      prepareSendMessagesRequest: ({ messages, body, id }) => {
        if (
          !navigateOnSend &&
          window.location.pathname !== `/chat/${threadId}`
        ) {
          window.history.replaceState({}, "", `/chat/${threadId}`);
        }
        const lastMessage = messages.at(-1)!;
        // Filter out UI-only parts (e.g., source-url) so the model doesn't receive unknown parts
        const attachments: ChatAttachment[] = lastMessage.parts.reduce(
          (acc: ChatAttachment[], part: any) => {
            if (part?.type === "file") {
              acc.push({
                type: "file",
                url: part.url,
                mediaType: part.mediaType,
                filename: part.filename,
              });
            } else if (part?.type === "source-url") {
              acc.push({
                type: "source-url",
                url: part.url,
                mediaType: part.mediaType,
                filename: part.title,
              });
            }
            return acc;
          },
          [],
        );

        const sanitizedLastMessage = {
          ...lastMessage,
          parts: lastMessage.parts.filter((p: any) => p?.type !== "source-url"),
        } as typeof lastMessage;

        // A mention pins tools within its own namespace and leaves the others
        // alone — see `lib/chat/mention-tool-scope`. A file attachment pins
        // nothing: it used to empty the toolkit list alongside mentions, which
        // silently stripped web search, the code tools and browser automation
        // from any message carrying a file — the same failure mode the
        // mention-scope fix removed for agent turns.
        const activeMentions = latestRef.current.mentions;
        const pinsDefaultTools = hasDefaultToolMention(activeMentions);
        const pinsMcpTools = hasMcpMention(activeMentions);

        const requestBody: ChatApiSchemaRequestBody = {
          ...body,
          id,
          chatModel:
            (body as { model: ChatModel })?.model ?? latestRef.current.model,
          autoRouting: latestRef.current.autoRouting,
          toolChoice: latestRef.current.toolChoice,
          planMode: latestRef.current.planMode,
          allowedAppDefaultToolkit: pinsDefaultTools
            ? []
            : resolveAllowedAppDefaultToolkits({
                allowedAppDefaultToolkit:
                  latestRef.current.allowedAppDefaultToolkit,
                projectId: latestRef.current.projectInfo?.id,
              }),
          allowedMcpServers: pinsMcpTools
            ? {}
            : latestRef.current.allowedMcpServers,
          mentions: latestRef.current.mentions,
          message: sanitizedLastMessage,
          imageTool: {
            model: latestRef.current.threadImageToolModel[threadId],
            // Read straight from the store: the composer sets it in the same
            // tick it sends, before any re-render could refresh latestRef.
            // Consumed once so a tool-result continuation cannot resend it.
            mask: takeThreadImageMask(threadId),
          },
          attachments,
        };
        return { body: requestBody };
      },
    }),
    messages: initialMessages,
    generateId: generateUUID,
    onFinish,
  });

  useAgentAlertNotifications({ threadId, messages, status });

  // Live chat state for the listeners below, which run outside React's render
  // and must not close over a stale status.
  const chatStateRef = useToRef({ status, error });

  // Wall clock of the last streamed update. A frozen tab receives no chunks
  // *and* runs no JS, so a large gap once it is visible again means the
  // connection died rather than the answer being slow.
  const lastStreamActivityRef = useRef(Date.now());
  useEffect(() => {
    lastStreamActivityRef.current = Date.now();
  }, [messages, status]);

  // Single owner of stream resumption (GET /api/chat/{id}/stream, the
  // transport's default reconnect URL; 204s when there is nothing to resume).
  // Deliberately NOT useChat's `resume` option: its effect only re-fires when
  // the boolean's VALUE changes, so switching directly between two threads
  // that are both "running" would skip the second — and running it alongside
  // this effect would double-resume on mount, which duplicates the assistant
  // message (makeRequest has no concurrency guard). Keyed off threadId so
  // every thread switch re-checks; the ref skips duplicate fires for the same
  // thread on the same Chat instance (dev StrictMode re-runs the effect).
  const resumedThreadRef = useRef<string | null>(null);
  // Same no-concurrency-guard hazard as above, now for the foreground/retry
  // paths: only one drain may be in flight. `resumeStream()` settles when the
  // resumed stream ends, so this stays set for the whole replay.
  const resumeInFlightRef = useRef(false);

  /**
   * Drain this thread's server-side buffer, if there is one. Resolves true
   * when a resume was started (or one is already running), false when there
   * is nothing to resume — the caller then falls back to regenerating.
   *
   * The endpoint is probed before `resumeStream()` because it answers 204 for
   * "nothing to resume" (no REDIS_URL, expired buffer, run already finished)
   * and useChat cannot report that back: it would still flip status to
   * "submitted" and clear `error`, wiping the error card for no reason. With
   * Redis unconfigured every call therefore ends here, leaving state untouched.
   *
   * The probe is a HEAD: a GET returns `resumeExistingStream()`, which attaches
   * a real consumer to the live buffer, so probing with one handed the run a
   * reader and then cancelled it.
   */
  const attemptResume = useCallback(async () => {
    if (resumeInFlightRef.current) return true;
    resumeInFlightRef.current = true;
    try {
      const probe = await fetch(`/api/chat/${threadId}/stream`, {
        method: "HEAD",
      });
      if (probe.status !== 200) return false;
      resumedThreadRef.current = threadId;
      // The buffer replays from the first chunk, so a partial assistant
      // message has to go or the answer renders twice — but only a partial
      // one. See `lib/chat/resumable-message`: dropping any trailing
      // assistant message deleted complete answers.
      setMessages((prev: UIMessage[]) =>
        isInterruptedAssistantTail(prev) ? prev.slice(0, -1) : prev,
      );
      await resumeStream();
      return true;
    } catch (error) {
      console.error("Failed to resume chat stream:", error);
      return false;
    } finally {
      resumeInFlightRef.current = false;
    }
  }, [threadId, resumeStream, setMessages]);

  // When there is nothing to resume (the server already finished, or is
  // between clearing its pointer and writing the answer), fall back to the
  // persisted thread tail — see `hooks/use-run-recovery`.
  const messagesRef = useToRef(messages);
  const { recoverRun, handleRetry, recoveryState } = useRunRecovery({
    threadId,
    enabled: !isDraftThread,
    error,
    messagesRef,
    chatStateRef,
    lastStreamActivityRef,
    attemptResume,
    stop,
    setMessages,
    clearError,
    sendMessage,
    regenerate,
  });

  useEffect(() => {
    if (resumedThreadRef.current === threadId) return;
    resumedThreadRef.current = threadId;
    if (
      (initialMessages.at(-1)?.metadata as ChatMetadata | undefined)
        ?.runStatus === "running"
    ) {
      void recoverRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const [isDeleteThreadPopupOpen, setIsDeleteThreadPopupOpen] = useState(false);

  const pendingSendKey = `chat-pending-send:${threadId}`;

  useEffect(() => {
    if (typeof window === "undefined" || navigateOnSend) return;
    const raw = sessionStorage.getItem(pendingSendKey);
    if (!raw) return;
    sessionStorage.removeItem(pendingSendKey);
    try {
      const message = JSON.parse(raw);
      void sendMessage(message);
      const titleSeed = extractTitleSeedFromSendMessage(message);
      if (titleSeed) {
        generateTitle(titleSeed);
      }
    } catch (error) {
      console.error("Failed to restore pending chat message:", error);
    }
  }, [generateTitle, navigateOnSend, pendingSendKey, sendMessage]);

  const handleSendMessage = useCallback<
    UseChatHelpers<UIMessage>["sendMessage"]
  >(
    async (message, options) => {
      if (!requireCredits()) return;

      // A tool call waiting on the UI (plan approval, requested input, manual
      // confirmation) blocks the run: the model cannot take another turn until
      // it has an output. Typing an answer instead of using the card is a
      // legitimate reply, so settle the call with the user's own text and let
      // their message be the next turn.
      const pending = pendingToolCallRef.current;
      if (pending) {
        pendingToolCallRef.current = null;
        // Suppress the automatic tool-result resend while this result lands —
        // otherwise the request fires twice: once for the tool output and once
        // for the message we are about to send. It is cleared again right
        // before the send below.
        stoppedRef.current = true;
        await _addToolResult({
          tool: pending.toolName,
          toolCallId: pending.toolCallId,
          output: buildAnsweredInChatOutput(extractSendMessageText(message)),
        });
      } else {
        // A new send clears any prior stop so auto tool-result resend works again.
        stoppedRef.current = false;
      }

      if (
        createProjectThreadOnSend &&
        isDraftThread &&
        typeof window !== "undefined"
      ) {
        try {
          const newThreadId = await createThreadWithProjectAction(
            createProjectThreadOnSend,
          );
          const pendingKey = `chat-pending-send:${newThreadId}`;
          sessionStorage.setItem(pendingKey, JSON.stringify(message));

          appStoreMutate((prev) => {
            const draftFiles = prev.threadFiles[threadId] ?? [];
            const { [threadId]: _removed, ...restFiles } = prev.threadFiles;
            return {
              threadFiles: draftFiles.length
                ? { ...restFiles, [newThreadId]: draftFiles }
                : restFiles,
            };
          });

          onThreadCreated?.(newThreadId);

          if (!embedded) {
            router.push(`/chat/${newThreadId}`);
          }
          return;
        } catch (error) {
          console.error("Failed to create project thread:", error);
          toast.error("Failed to start chat");
          return;
        }
      }

      if (
        navigateOnSend &&
        !embedded &&
        typeof window !== "undefined" &&
        window.location.pathname !== `/chat/${threadId}`
      ) {
        sessionStorage.setItem(pendingSendKey, JSON.stringify(message));
        router.push(`/chat/${threadId}`);
        return Promise.resolve();
      }
      stoppedRef.current = false;
      return sendMessage(message, options);
    },
    [
      _addToolResult,
      appStoreMutate,
      createProjectThreadOnSend,
      embedded,
      isDraftThread,
      navigateOnSend,
      onThreadCreated,
      pendingSendKey,
      router,
      sendMessage,
      threadId,
    ],
  );

  const addToolResult = useCallback(
    async (result: Parameters<typeof _addToolResult>[0]) => {
      // A fresh tool result means the user re-engaged; allow auto-resend again.
      stoppedRef.current = false;
      await _addToolResult(result);
      // sendMessage();
    },
    [_addToolResult],
  );

  // Stop the run and, when a tool call is left dangling (no output*), rewrite
  // it to an errored state. That clears isPendingToolCall so the input
  // re-enables, and — because we rewrite rather than truncate — the client
  // transcript stays in sync with the partial the server persists as
  // "cancelled" (no message removal). Phase 2 also POSTs a detached stop.
  const handleStop = useCallback(() => {
    stoppedRef.current = true;
    stop();
    // Detached stop: also flag the server so a run that outlived this tab (or is
    // being watched from another tab) actually halts. No-op without Redis.
    void fetch(`/api/chat/${threadId}/stop`, { method: "POST" }).catch(
      () => {},
    );
    setMessages((prev: UIMessage[]) => {
      const last = prev.at(-1);
      if (!last || last.role !== "assistant") return prev;
      const lastPart = last.parts.at(-1);
      if (!lastPart || !isToolUIPart(lastPart)) return prev;
      if (lastPart.state.startsWith("output")) return prev;
      const parts = last.parts.slice();
      parts[parts.length - 1] = {
        ...lastPart,
        state: "output-error",
        errorText: "Cancelled",
      } as typeof lastPart;
      return [...prev.slice(0, -1), { ...last, parts }];
    });
  }, [stop, setMessages, threadId]);

  const mounted = useMounted();

  const latestRef = useToRef({
    toolChoice,
    planMode,
    model,
    autoRouting,
    allowedAppDefaultToolkit,
    allowedMcpServers,
    messages,
    threadId,
    mentions: threadMentions[threadId],
    threadImageToolModel,
    projectInfo,
  });

  const isLoading = useMemo(
    () => status === "streaming" || status === "submitted",
    [status],
  );

  const emptyMessage = useMemo(
    () => messages.length === 0 && !error,
    [messages.length, error],
  );

  const isInitialThreadEntry = useMemo(
    () =>
      initialMessages.length > 0 &&
      initialMessages.at(-1)?.id === messages.at(-1)?.id,
    [messages],
  );

  const pendingToolCall = useMemo(
    () => findPendingToolCall(messages, status),
    [status, messages],
  );

  const isPendingToolCall = !!pendingToolCall;

  useEffect(() => {
    pendingToolCallRef.current = pendingToolCall;
  }, [pendingToolCall]);

  const space = useMemo(() => {
    if (!isLoading || error) return false;
    const lastMessage = messages.at(-1);
    if (lastMessage?.role == "user") return "think";
    const lastPart = lastMessage?.parts.at(-1);
    if (!lastPart) return "think";
    const secondPart = lastMessage?.parts[1];
    if (secondPart?.type == "text" && secondPart.text.length == 0)
      return "think";
    if (lastPart?.type == "step-start") {
      return lastMessage?.parts.length == 1 ? "think" : "space";
    }
    return false;
  }, [isLoading, messages.at(-1)]);

  const particle = useMemo(() => {
    if (!showDecorations) return null;

    return (
      <AnimatePresence>
        {showParticles && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 5 }}
          >
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <LightRays />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <Particles particleCount={400} particleBaseSize={10} />
            </div>

            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-t from-background to-50% to-transparent z-20" />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-l from-background to-20% to-transparent z-20" />
            </div>
            <div className="absolute top-0 left-0 w-full h-full z-10">
              <div className="w-full h-full bg-gradient-to-r from-background to-20% to-transparent z-20" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }, [showDecorations, showParticles]);

  const debounce = useMemo(() => createDebounce(), []);
  const handleFocus = useCallback(() => {
    setShowParticles(false);
    debounce(() => setShowParticles(true), 60000);
  }, [debounce]);

  const handleScroll = useCallback(() => {
    handleScrollAnchor();
    handleFocus();
  }, [handleScrollAnchor, handleFocus]);

  useEffect(() => {
    if (isDraftThread) return;

    appStoreMutate({ currentThreadId: threadId });

    // Decide whether this mount actually creates or renames the thread before
    // touching the local list. Only those two cases need the sidebar's
    // /api/thread query revalidated; a plain revisit already has fresh data, so
    // revalidating on every mount just re-runs the query the sidebar fetched.
    const existing = appStore
      .getState()
      .threadList.find((thread) => thread.id === threadId);
    const isCreate = !existing;
    const isRename =
      !!existing && !existing.title?.trim() && !!initialThread?.title?.trim();

    appStoreMutate((prev) => {
      const prevExisting = prev.threadList.find(
        (thread) => thread.id === threadId,
      );
      if (prevExisting) {
        if (!initialThread?.title?.trim() || prevExisting.title?.trim()) {
          return prev;
        }
        return {
          threadList: prev.threadList.map((thread) =>
            thread.id === threadId
              ? { ...thread, title: initialThread.title ?? thread.title }
              : thread,
          ),
        };
      }

      return {
        threadList: [
          {
            id: threadId,
            title: initialThread?.title ?? "",
            userId: "",
            createdAt: new Date(),
            projectId: initialThread?.projectId,
          },
          ...prev.threadList,
        ],
      };
    });
    if (isCreate || isRename) {
      mutate("/api/thread");
    }
    return () => {
      appStoreMutate({ currentThreadId: null });
    };
  }, [
    appStoreMutate,
    initialThread?.projectId,
    initialThread?.title,
    isDraftThread,
    threadId,
  ]);

  // Restore the thread's agent when it is opened fresh. The selection lives in
  // client state, so a thread reached from a scheduled run's notification (or
  // any reload) would otherwise show no agent and quietly send the next message
  // to the plain assistant. Message metadata is the only server-side record.
  useEffect(() => {
    if (!threadId || pendingThreadMention) return;
    const existing = appStore.getState().threadMentions[threadId];
    if (existing?.some((mention) => mention.type === "agent")) return;

    const agentId = latestAgentIdFromMessages(initialMessages);
    if (!agentId) return;
    const agent = appStore
      .getState()
      .agentList.find((candidate) => candidate.id === agentId);
    // The agent may have been deleted, or be one this user can no longer see;
    // leaving the composer empty is the correct outcome then.
    if (!agent) return;

    appStoreMutate((prev) => ({
      threadMentions: {
        ...prev.threadMentions,
        [threadId]: [
          ...(prev.threadMentions[threadId] ?? []).filter(
            (mention) => mention.type !== "agent",
          ),
          {
            type: "agent",
            name: agent.name,
            icon: agent.icon,
            description: agent.description,
            agentId: agent.id,
          },
        ],
      },
    }));
  }, [threadId, pendingThreadMention, initialMessages, appStoreMutate]);

  // The composer's knowledge-base chips are mentions, but the durable record
  // is the thread's own column: restore it once per thread so a reload keeps
  // searching what the user attached. Only chips the thread no longer carries
  // are dropped; everything else the user picked this session stays.
  const hydratedKnowledgeThreadId = useRef<string | null>(null);
  useEffect(() => {
    if (!threadId || hydratedKnowledgeThreadId.current === threadId) return;
    hydratedKnowledgeThreadId.current = threadId;
    const bindings = initialThread?.knowledgeBases ?? [];
    if (!bindings.length) return;
    appStoreMutate((prev) => {
      const current = prev.threadMentions[threadId] ?? [];
      const known = new Set(
        current
          .filter((m) => m.type === "knowledgeBase")
          .map((m) => m.knowledgeBaseId),
      );
      const restored: ChatMention[] = bindings
        .filter((binding) => !known.has(binding.id))
        .map((binding) => ({
          type: "knowledgeBase",
          name: binding.name ?? "",
          knowledgeBaseId: binding.id,
          sourceType: binding.type,
        }));
      if (!restored.length) return prev;
      return {
        threadMentions: {
          ...prev.threadMentions,
          [threadId]: [...current, ...restored],
        },
      };
    });
  }, [threadId, initialThread?.knowledgeBases, appStoreMutate]);

  useEffect(() => {
    if (pendingThreadMention && threadId) {
      appStoreMutate((prev) => ({
        threadMentions: {
          ...prev.threadMentions,
          [threadId]: [pendingThreadMention],
        },
        pendingThreadMention: undefined,
      }));
    }
  }, [pendingThreadMention, threadId, appStoreMutate]);

  useEffect(() => {
    if (isInitialThreadEntry) scrollToBottom("instant");
  }, [isInitialThreadEntry]);

  useGlobalShortcut((e: KeyboardEvent) => {
    const messages = latestRef.current.messages;
    if (messages.length === 0) return;
    const isLastMessageCopy = isShortcutEvent(e, Shortcuts.lastMessageCopy);
    const isDeleteThread = isShortcutEvent(e, Shortcuts.deleteThread);
    if (!isDeleteThread && !isLastMessageCopy) return;
    e.preventDefault();
    e.stopPropagation();
    if (isLastMessageCopy) {
      const lastMessage = messages.at(-1);
      const lastMessageText = lastMessage!.parts
        .filter((part): part is TextUIPart => part.type == "text")
        ?.at(-1)?.text;
      if (!lastMessageText) return;
      navigator.clipboard.writeText(lastMessageText);
    }
    if (isDeleteThread) {
      setIsDeleteThreadPopupOpen(true);
    }
  }, []);

  useEffect(() => {
    if (mounted) {
      handleFocus();
    }
  }, [input]);

  return (
    <ArtifactPanelProvider>
      <ChatBotInner
        particle={particle}
        emptyMessage={emptyMessage}
        isDragging={isDragging}
        messages={messages}
        initialHasMore={initialMessages.length >= CHAT_MESSAGE_WINDOW}
        status={status}
        addToolResult={addToolResult}
        _addToolApprovalResponse={_addToolApprovalResponse}
        isLoading={isLoading}
        isPendingToolCall={isPendingToolCall}
        space={space}
        error={error}
        onRetry={handleRetry}
        recoveryState={recoveryState}
        containerRef={containerRef}
        handleScroll={handleScroll}
        isAtBottom={isAtBottom}
        scrollToBottom={scrollToBottom}
        input={input}
        threadId={threadId}
        sendMessage={handleSendMessage}
        setMessages={setMessages}
        setInput={setInput}
        stop={handleStop}
        isFirstTime={Boolean(isFirstTime)}
        handleFocus={handleFocus}
        projectInfo={projectInfo}
        showProjectContextBadge={showProjectContextBadge}
        autoFocusInput={autoFocusInput}
        embedded={embedded}
        isDeleteThreadPopupOpen={isDeleteThreadPopupOpen}
        setIsDeleteThreadPopupOpen={setIsDeleteThreadPopupOpen}
      />
    </ArtifactPanelProvider>
  );
}

// ---------------------------------------------------------------------------
// ChatBotInner — rendered inside ArtifactPanelProvider so useArtifactPanel
// is available. Mirrors the Fragments md:grid-cols-2 split layout.
// ---------------------------------------------------------------------------
function ChatBotInner({
  particle,
  emptyMessage,
  isDragging,
  messages,
  initialHasMore,
  status,
  addToolResult,
  _addToolApprovalResponse,
  isLoading,
  isPendingToolCall,
  space,
  error,
  onRetry,
  recoveryState,
  containerRef,
  handleScroll,
  isAtBottom,
  scrollToBottom,
  input,
  threadId,
  sendMessage,
  setMessages,
  setInput,
  stop,
  isFirstTime,
  handleFocus,
  projectInfo,
  showProjectContextBadge = true,
  autoFocusInput = true,
  embedded = false,
  isDeleteThreadPopupOpen,
  setIsDeleteThreadPopupOpen,
}: {
  particle: React.ReactNode;
  emptyMessage: boolean;
  isDragging: boolean;
  messages: any[];
  initialHasMore: boolean;
  status: any;
  addToolResult: any;
  _addToolApprovalResponse: any;
  isLoading: boolean;
  isPendingToolCall: boolean;
  space: any;
  error: any;
  onRetry: () => void;
  recoveryState: RecoveryState;
  containerRef: React.RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  isAtBottom: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  input: string;
  threadId: string;
  sendMessage: any;
  setMessages: any;
  setInput: any;
  stop: () => void;
  isFirstTime: boolean;
  handleFocus: () => void;
  projectInfo?: { id: string; name: string };
  showProjectContextBadge?: boolean;
  autoFocusInput?: boolean;
  embedded?: boolean;
  isDeleteThreadPopupOpen: boolean;
  setIsDeleteThreadPopupOpen: (v: boolean) => void;
}) {
  const { isOpen: isPanelOpen } = useArtifactPanel();
  // The Work | Cockpit toggle belongs to the home screen's empty chat only.
  const isHomeScreen = usePathname() === "/";

  const composerRef = useRef<HTMLDivElement>(null);
  // Size the trailing filler to the room actually left below the newest prompt.
  // Recomputed whenever the message list or the viewport changes, so an iOS
  // `dvh` shift (URL bar, keyboard) cannot leave a stale reserve behind that a
  // later scroll-to-bottom would use to hide the prompt under the header.
  const [tailReserve, setTailReserve] = useState(0);
  useEffect(() => {
    const measure = () => {
      const scroller = containerRef.current;
      if (!scroller) return;
      const composerOverlay = composerRef.current
        ? composerRef.current.getBoundingClientRect().height + COMPOSER_GAP_PX
        : 0;
      const message = scroller.querySelector<HTMLElement>(
        '[data-user-message="last"]',
      );
      setTailReserve(
        tailReservePx({
          clientHeight: scroller.clientHeight,
          // Everything from the prompt's top edge down, filler excluded. With no
          // prompt to pin, this collapses to the composer-clearing floor.
          contentBelowMessageTop: message
            ? scroller.scrollHeight - tailReserve - message.offsetTop
            : Number.POSITIVE_INFINITY,
          composerOverlay,
          scrollPaddingTop: Number.parseFloat(
            getComputedStyle(scroller).paddingTop || "0",
          ),
        }),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    // iOS fires no `resize` when the keyboard opens — only the visual viewport
    // changes, and `ViewportSync` resizes the shell off that. Without this the
    // reserve would keep the pre-keyboard height and hide the newest prompt.
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
    // Deliberately keyed on message *count* and the think/space phase, not on
    // `messages` itself: the latter changes on every streamed token, and
    // measuring forces a layout, which would violate the O(tail block)
    // per-update budget the streaming render is built around.
    // `tailReserve` is read to subtract the current filler, not to re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, space, status, containerRef]);

  // Opening the keyboard shortens the scroll region; re-pin the bottom so the
  // newest message rides above the composer instead of ending up behind it.
  // Gated on the composer holding focus: iOS also resizes the visual viewport
  // while its URL bar collapses mid-scroll, and re-pinning on that would yank
  // the conversation back down the moment someone scrolls up.
  const isAtBottomRef = useToRef(isAtBottom);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const repin = () => {
      if (!isAtBottomRef.current) return;
      if (!composerRef.current?.contains(document.activeElement)) return;
      scrollToBottom("instant");
    };
    viewport.addEventListener("resize", repin);
    return () => viewport.removeEventListener("resize", repin);
  }, [isAtBottomRef, scrollToBottom]);

  // Dragging the conversation dismisses the keyboard, the way every phone
  // messenger behaves. Bound to the drag rather than to `scroll` on purpose:
  // streaming scrolls the list on its own, and blurring on that would fight
  // anyone typing a follow-up while an answer comes in.
  const dismissKeyboardOnDrag = useCallback(() => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return;
    if (!composerRef.current?.contains(focused)) return;
    focused.blur();
  }, []);

  const [hasMoreOlder, setHasMoreOlder] = useState(initialHasMore);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  const loadOlder = useCallback(async () => {
    const oldest = messages[0];
    if (!oldest || isLoadingOlder) return;
    setIsLoadingOlder(true);
    try {
      const older = await loadOlderThreadMessagesAction(threadId, oldest.id);
      if (older.length < CHAT_MESSAGE_WINDOW) setHasMoreOlder(false);
      if (older.length === 0) return;
      const el = containerRef.current;
      const prevHeight = el?.scrollHeight ?? 0;
      setMessages((prev: any[]) => [
        ...older.map((m) => ({
          id: m.id,
          role: m.role,
          parts: m.parts,
          metadata: m.metadata,
        })),
        ...prev,
      ]);
      // Keep the viewport anchored on the same message after prepending.
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } catch (e) {
      console.error(e);
      toast.error("Could not load older messages");
    } finally {
      setIsLoadingOlder(false);
    }
  }, [messages, threadId, isLoadingOlder, setMessages, containerRef]);

  // Surface a persisted terminal run state when reopening a thread that ended
  // badly — e.g. an orphaned run repaired to "failed" on load, or a run that
  // timed out / was cancelled server-side. This is distinct from the live
  // `error` (transport/stream failure) that ErrorMessage already renders, so it
  // is gated on `!error` and only shows once streaming has settled. Retry
  // reuses regenerate via onRetry.
  const terminalRunStatus: string | undefined =
    messages.at(-1)?.metadata?.runStatus;

  // Latest assistant usage feeds the composer's context-window meter. Usage
  // metadata arrives with the stream's finish part and rides along on
  // persisted messages, so this covers live chats and reloads alike.
  const latestContextUsage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.metadata?.usage) {
        return { usage: m.metadata.usage, model: m.metadata.chatModel };
      }
    }
    return undefined;
  }, [messages]);
  const terminalNoticeText =
    !error && !isLoading
      ? terminalRunStatus === "failed"
        ? "This response didn't finish. You can try again."
        : terminalRunStatus === "timed_out"
          ? "This response timed out before finishing. You can try again."
          : terminalRunStatus === "cancelled"
            ? "This response was stopped."
            : terminalRunStatus === "incomplete"
              ? "This response was cut off before finishing. You can continue."
              : undefined
      : undefined;

  return (
    <>
      {particle}
      {/* Fragments-style grid: chat left, preview panel right */}
      <div className="flex w-full h-full min-w-0 relative">
        {/* Chat column */}
        <div
          className={cn(
            embedded && "justify-end pb-2",
            !embedded &&
              emptyMessage &&
              (autoFocusInput ? "justify-center pb-24" : "justify-start pt-2"),
            "flex flex-col min-w-0 relative h-full z-40 flex-1 transition-all duration-300",
            isPanelOpen && "hidden md:flex",
          )}
        >
          {isDragging && (
            <div className="absolute inset-0 z-40 bg-background/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
              <div className="rounded-2xl px-6 py-5 bg-background/80 shadow-xl border border-border flex items-center gap-3">
                <div className="rounded-full bg-primary/10 p-2 text-primary">
                  <FilePlus className="size-6" />
                </div>
                <span className="text-sm text-muted-foreground">
                  Drop files to upload
                </span>
              </div>
            </div>
          )}
          {emptyMessage ? (
            embedded ? null : (
              <>
                {/* Work | Cockpit switch: home screen only, never in a thread.
                    Pinned to the top of the chat area, right under the app
                    header, so it does not sit on top of the greeting. */}
                {isHomeScreen && (
                  <div className="absolute inset-x-0 top-2 z-10 flex justify-center px-4">
                    <WorkspaceModeToggle />
                  </div>
                )}
                <ChatGreeting />
              </>
            )
          ) : (
            <>
              <div
                className={cn(
                  // `flex-1 min-h-0` makes this the single bounded scroll
                  // region that fills the space *below* the sticky header, so
                  // the message list scrolls inside it. Without it the content
                  // overflows and the outer scroller drifts the whole chat up
                  // behind the header, hiding a freshly-sent message.
                  // `overscroll-contain` keeps mobile rubber-band scrolling
                  // inside this region instead of chaining to the shell, and
                  // `overflow-x-hidden` keeps a wide message (diagram, table,
                  // code line) scrolling inside its own container instead of
                  // widening the chat column, which on touch devices let the
                  // whole conversation be swiped left/right.
                  "flex flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain py-6 z-10 flex-1 min-h-0 min-w-0",
                )}
                ref={containerRef}
                onScroll={handleScroll}
                onTouchMove={dismissKeyboardOnDrag}
              >
                <ChatMessageList
                  messages={messages}
                  status={status}
                  isLoading={isLoading || isPendingToolCall}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                  threadId={threadId}
                  projectId={projectInfo?.id}
                  addToolResult={addToolResult}
                  addToolApprovalResponse={_addToolApprovalResponse}
                  hasMoreOlder={hasMoreOlder}
                  isLoadingOlder={isLoadingOlder}
                  onLoadOlder={loadOlder}
                  messageClassName={(message, isLastMessage) =>
                    isLastMessage &&
                    message.role != "user" &&
                    !space &&
                    message.parts.length > 1
                      ? "min-h-[calc(55dvh-40px)]"
                      : ""
                  }
                />
                {space && (
                  <div className="w-full mx-auto max-w-3xl px-4 sm:px-6 relative">
                    <div className={space == "space" ? "opacity-0" : ""}>
                      <Think />
                    </div>
                  </div>
                )}

                {error && (
                  <ErrorMessage
                    error={error}
                    onRetry={onRetry}
                    recovery={recoveryState}
                  />
                )}
                {!error && terminalNoticeText && (
                  <ErrorMessage
                    error={new Error(terminalNoticeText)}
                    onRetry={onRetry}
                  />
                )}
                {/* Filler that lifts the newest prompt to the top of the
                    viewport while the answer streams in. Measured rather than a
                    fixed `55dvh` + `13rem`: on a phone those exceeded the room
                    below the message, so scrolling to the bottom pushed the
                    prompt above the scrollport and behind the header. */}
                {/* `minHeight` + `shrink-0`, never `height`: this is a flex item
                    in a column that overflows, and a definite `height` gets
                    shrunk to 0 — which left the end of a long answer behind the
                    composer. `min-height` survives flex shrinking. */}
                <div
                  className="min-w-0 shrink-0"
                  style={{ minHeight: tailReserve }}
                />
              </div>
            </>
          )}

          <div
            ref={composerRef}
            className={clsx(
              // Anchored to the bottom edge rather than floating 3.5rem above
              // it: that gap left a strip where messages scrolled past in the
              // open, which on a phone reads as the conversation sliding out
              // from under a white box. The gradient fades the list out behind
              // the composer instead of cutting it off. `pointer-events-none`
              // keeps the transparent part of that fade from swallowing taps —
              // the two children opt back in.
              messages.length &&
                !embedded &&
                "absolute inset-x-0 bottom-0 pt-6 pb-4 pointer-events-none bg-gradient-to-t from-background via-background to-transparent",
              embedded && "mt-auto flex-shrink-0 w-full",
              "w-full z-10",
            )}
          >
            <div
              className={cn(
                "mx-auto relative flex justify-center items-center -top-2",
                embedded ? "max-w-none" : "max-w-3xl",
              )}
            >
              <ScrollToBottomButton
                className="pointer-events-auto"
                show={!isAtBottom && messages.length > 0}
                onClick={() => scrollToBottom()}
              />
            </div>

            <div className="pointer-events-auto">
              <PromptInput
                input={input}
                threadId={threadId}
                sendMessage={sendMessage}
                setInput={setInput}
                // Deliberately not blocked by `isPendingToolCall`: a waiting
                // approval/input card must not lock the composer — sending
                // settles that call with the typed answer (see handleSendMessage).
                isLoading={isLoading}
                onStop={stop}
                onFocus={isFirstTime ? undefined : handleFocus}
                projectInfo={projectInfo}
                showProjectContextBadge={showProjectContextBadge}
                autoFocusInput={autoFocusInput}
                embedded={embedded}
                contextUsage={latestContextUsage?.usage}
                contextUsageModel={latestContextUsage?.model}
              />
            </div>
          </div>
          <DeleteThreadPopup
            threadId={threadId}
            onClose={() => setIsDeleteThreadPopupOpen(false)}
            open={isDeleteThreadPopupOpen}
          />
        </div>

        {/* Right panel — ported from e2b-dev/fragments preview.tsx */}
        <ArtifactPanel
          onShare={() =>
            sendMessage({
              text: "Publish the page you just built to a shareable link. Rewrite it as one self-contained HTML document — inline the CSS, keep any interactivity as inline vanilla JS, and reference the uploaded images by their existing URLs rather than embedding them. Then give me the link.",
            })
          }
        />
      </div>
    </>
  );
}

function DeleteThreadPopup({
  threadId,
  onClose,
  open,
}: { threadId: string; onClose: () => void; open: boolean }) {
  const t = useTranslations();
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();
  const handleDelete = useCallback(() => {
    setIsDeleting(true);
    safe(() => deleteThreadAction(threadId))
      .watch(() => setIsDeleting(false))
      .ifOk(() => {
        // Track thread deletion
        analytics.chatThreadDeleted({
          threadId,
        });

        router.push("/");
      })
      .ifFail(() => toast.error(t("Chat.Thread.failedToDeleteThread")))
      .watch(() => onClose());
  }, [threadId, router, onClose, t]);
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Chat.Thread.deleteChat")}</DialogTitle>
          <DialogDescription>
            {t("Chat.Thread.areYouSureYouWantToDeleteThisChatThread")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t("Common.cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} autoFocus>
            {t("Common.delete")}
            {isDeleting && <Loader className="size-3.5 ml-2 animate-spin" />}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
