import { loadLatestThreadMessagesAction } from "@/app/api/chat/actions";
import { isNetworkError } from "@/lib/chat/network-error";
import {
  type ReconcileResult,
  reconcilePersistedTail,
} from "@/lib/chat/persisted-tail";
import type { UseChatHelpers } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { mutate } from "swr";

/**
 * How long a "streaming" run may go without any update before a returning
 * foreground treats the connection as dead and tries to recover it.
 */
export const STREAM_STALE_MS = 30_000;

/** Interval between persisted-tail reads while the server is still running. */
export const RECOVERY_POLL_MS = 5_000;

/** Longest a poll keeps going: the chat route's `maxDuration`. */
export const RECOVERY_POLL_MAX_MS = 300_000;

/** What the error card tells the user while recovery is under way. */
export type RecoveryState = "checking" | "running" | undefined;

type Helpers = UseChatHelpers<UIMessage>;

type Outcome =
  | ReconcileResult["kind"]
  /** The live buffer was resumed; useChat is streaming again. */
  | "resumed"
  /** The transcript changed while the read was in flight (a new send, a tool
   * result, a stop); whatever came back no longer applies. */
  | "stale"
  /** useChat has a live, recently active stream: nothing to recover. */
  | "healthy"
  /** The thread changed or the component went away mid-poll. */
  | "cancelled";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isVisible = () =>
  typeof document === "undefined" || document.visibilityState === "visible";

/**
 * Brings a chat whose stream died back in line with what the server did.
 *
 * The chat route keeps generating after the browser drops the connection (a
 * frozen iOS tab, a lost network) and persists the answer when it is done.
 * `attemptResume` can only replay a run that is still going: the moment the
 * server finishes it clears its resume pointer, so a tab that comes back after
 * that has an error card and no way to the answer short of a reload. This hook
 * adds that way: when there is nothing to resume it reads the newest persisted
 * rows, and if the turn has ended it swaps them in and clears the error. If
 * the server is still working it re-reads every few seconds while the tab is
 * visible, for as long as the route may run.
 *
 * Recovery runs from three places: the tab coming back to the foreground, a
 * transport error surfacing while the tab is visible, and the Retry button.
 * Retry only pays for a new generation when the server has nothing for this
 * turn at all.
 */
export function useRunRecovery({
  threadId,
  enabled,
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
}: {
  threadId: string;
  /** False for threads that have no row yet (project drafts). */
  enabled: boolean;
  error: Helpers["error"];
  messagesRef: RefObject<UIMessage[]>;
  chatStateRef: RefObject<{
    status: Helpers["status"];
    error: Helpers["error"];
  }>;
  lastStreamActivityRef: RefObject<number>;
  /** Drains the server-side buffer when there is one; true when it did. */
  attemptResume: () => Promise<boolean>;
  /** useChat's own `stop`, not the composer's wrapper (which POSTs a detached
   * stop and rewrites the pending tool part). */
  stop: Helpers["stop"];
  setMessages: Helpers["setMessages"];
  clearError: Helpers["clearError"];
  sendMessage: Helpers["sendMessage"];
  regenerate: Helpers["regenerate"];
}): {
  recoverRun: () => Promise<boolean>;
  handleRetry: () => void;
  recoveryState: RecoveryState;
} {
  const [recoveryState, setRecoveryState] = useState<RecoveryState>(undefined);
  // Only one recovery may be in flight: a resume settles when the replay ends,
  // and concurrent resumes duplicate the assistant message.
  const inFlightRef = useRef(false);
  const lastOutcomeRef = useRef<Outcome | null>(null);
  // Id of the last message after a settled reconcile. The fetch that died may
  // still reject after the swap; that late error has nothing left to recover.
  const settledTailRef = useRef<string | null>(null);
  // Bumped to cancel a poll when the thread changes or the hook unmounts.
  const pollTokenRef = useRef(0);

  useEffect(() => {
    return () => {
      pollTokenRef.current += 1;
    };
  }, [threadId]);

  const reconcileOnce = useCallback(async (): Promise<Outcome> => {
    const { status, error: liveError } = chatStateRef.current;
    if (
      !liveError &&
      (status === "streaming" || status === "submitted") &&
      Date.now() - lastStreamActivityRef.current < STREAM_STALE_MS
    ) {
      return "healthy";
    }

    const lastId = messagesRef.current.at(-1)?.id;
    let rows: Awaited<ReturnType<typeof loadLatestThreadMessagesAction>>;
    try {
      rows = await loadLatestThreadMessagesAction(threadId);
    } catch (cause) {
      console.error("Failed to read the persisted thread tail:", cause);
      return "unknown";
    }
    if (messagesRef.current.at(-1)?.id !== lastId) return "stale";

    const result = reconcilePersistedTail(messagesRef.current, rows);
    if (result.kind === "settled") {
      // The server is done, so the client's fetch (if it is still pending at
      // all) can only be a dead one: abort it so it cannot reject into a fresh
      // error after the swap. An abort ends as status "ready", not "error".
      await stop();
      setMessages((prev: UIMessage[]) =>
        prev.at(-1)?.id === lastId ? result.messages : prev,
      );
      settledTailRef.current = result.messages.at(-1)?.id ?? null;
      clearError();
      void mutate("/api/thread");
    } else if (result.kind === "client-ahead") {
      // Re-issue the last message (the assistant turn carrying the tool
      // result), exactly what the automatic tool-result resend does.
      clearError();
      void sendMessage();
    }
    return result.kind;
  }, [
    threadId,
    chatStateRef,
    messagesRef,
    lastStreamActivityRef,
    stop,
    setMessages,
    clearError,
    sendMessage,
  ]);

  const pollUntilSettled = useCallback(async (): Promise<Outcome> => {
    const token = ++pollTokenRef.current;
    const deadline = Date.now() + RECOVERY_POLL_MAX_MS;
    setRecoveryState("running");
    while (Date.now() < deadline) {
      await sleep(RECOVERY_POLL_MS);
      if (pollTokenRef.current !== token) return "cancelled";
      // A hidden tab stops asking; the foreground listener starts over.
      if (!isVisible()) return "running";
      const outcome = await reconcileOnce();
      if (pollTokenRef.current !== token) return "cancelled";
      if (outcome !== "running") return outcome;
    }
    return "running";
  }, [reconcileOnce]);

  const recoverRun = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return true;
    inFlightRef.current = true;
    setRecoveryState("checking");
    try {
      if (await attemptResume()) {
        lastOutcomeRef.current = "resumed";
        return true;
      }
      if (!enabled) {
        lastOutcomeRef.current = "unknown";
        return false;
      }
      let outcome = await reconcileOnce();
      if (outcome === "running") outcome = await pollUntilSettled();
      lastOutcomeRef.current = outcome;
      return outcome === "settled" || outcome === "client-ahead";
    } catch (cause) {
      console.error("Failed to recover chat run:", cause);
      lastOutcomeRef.current = null;
      return false;
    } finally {
      inFlightRef.current = false;
      setRecoveryState(undefined);
    }
  }, [enabled, attemptResume, reconcileOnce, pollUntilSettled]);

  // Retry first tries to hand back the answer the server already produced
  // (and billed) before paying for a second generation.
  const handleRetry = useCallback(() => {
    const hadError = Boolean(chatStateRef.current.error);
    void recoverRun()
      .catch(() => false)
      .then(() => {
        const outcome = lastOutcomeRef.current;
        if (outcome === "resumed" || outcome === "client-ahead") return;
        // With a live transport error, regenerate only when the server has
        // nothing for this turn. Without one the card is the persisted
        // terminal state itself (failed, timed out, stopped), and Retry means
        // "run it again".
        if (hadError && outcome !== "unknown") return;
        clearError();
        void regenerate();
      });
  }, [recoverRun, chatStateRef, clearError, regenerate]);

  // iOS Safari freezes a backgrounded tab and tears the in-flight SSE
  // connection down at the network layer: the fetch rejects with WebKit's
  // "Load failed" (or simply stalls) while the server keeps generating.
  // Re-check whenever the tab comes back.
  useEffect(() => {
    const onForeground = () => {
      if (!isVisible()) return;
      const { status, error: liveError } = chatStateRef.current;
      if (!liveError) {
        // useChat still believes it is connected. Only a long silence says
        // otherwise; resuming a healthy stream would give it a second reader.
        if (status !== "streaming" && status !== "submitted") return;
        if (Date.now() - lastStreamActivityRef.current < STREAM_STALE_MS)
          return;
      }
      void recoverRun();
    };
    document.addEventListener("visibilitychange", onForeground);
    // A bfcache restore fires pageshow without a visibilitychange.
    window.addEventListener("pageshow", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("pageshow", onForeground);
    };
  }, [recoverRun, chatStateRef, lastStreamActivityRef]);

  // A connection error that surfaces while the tab is visible (a dropped
  // network on desktop, or iOS delivering the rejection after the
  // visibilitychange) recovers straight away rather than waiting for Retry.
  useEffect(() => {
    if (!enabled || !error || !isNetworkError(error) || !isVisible()) return;
    if (
      settledTailRef.current &&
      messagesRef.current.at(-1)?.id === settledTailRef.current
    ) {
      clearError();
      return;
    }
    void recoverRun();
  }, [error, enabled, messagesRef, clearError, recoverRun]);

  return { recoverRun, handleRetry, recoveryState };
}
