"use client";

import { appStore } from "@/app/store";
import { announceCockpitPushUpdate } from "@/hooks/queries/use-cockpit-updates";
import { experimental_useRealtime } from "@ai-sdk/react";
import type { Experimental_RealtimeServerEvent } from "ai";
import { isToolUIPart } from "ai";
import { generateUUID } from "lib/utils";
import { isBrowserVoiceAppTool } from "lib/voice/app-tool-definitions";
import {
  startVoiceBrowserRun,
  VoiceBrowserRunError,
} from "lib/voice/browser-run-client";
import {
  VOICE_BROWSER_CHECK_TIMEOUT_MS,
  type VoiceBrowserFrame,
} from "lib/voice/browser-run-contract";
import { matchAgentByReference } from "lib/voice/match-agent";
import {
  OpenAIRealtimeFunctionTool,
  isDefaultVoiceTool,
} from "lib/voice/openai-tools";
import { flushVoiceSessionTurns } from "lib/voice/session-thread-client";
import {
  VOICE_THREAD_FLUSH_DEBOUNCE_MS,
  selectVoiceTurnsToPersist,
} from "lib/voice/session-thread-contract";
import {
  VoiceToolExecutionMap,
  VoiceToolStatus,
  createEmptyVoiceToolStatus,
} from "lib/voice/types";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { analytics } from "lib/analytics/posthog";
import { UIMessageWithCompleted, VoiceChatOptions, VoiceChatSession } from "..";
import {
  buildRealtimeSessionConfig,
  buildVoiceWireSession,
} from "./realtime-session-config";
import {
  DEFAULT_OPENAI_VOICE,
  resolveOpenAIVoicePreset,
} from "./voice-constants";
import {
  type VoiceSessionConfirmation,
  type VoiceSettings,
  checkSessionConfirmation,
  normalizeVoiceSettings,
} from "./voice-settings";
import {
  createBrowserGatewayRealtimeModel,
  setBrowserGatewayTeamIdOrSlug,
} from "./voice-gateway-client";
import { buildVoiceTokenApiUrl } from "./voice-token-api";

function extractUsageFromRealtimeEvent(
  event: Experimental_RealtimeServerEvent,
): {
  responseId: string;
  promptTokens: number;
  completionTokens: number;
} | null {
  const raw = event as Record<string, unknown>;
  const type = raw.type;
  if (type !== "response-done" && type !== "response.done") {
    return null;
  }

  const response =
    typeof raw.response === "object" && raw.response !== null
      ? (raw.response as Record<string, unknown>)
      : undefined;

  const usage =
    typeof raw.usage === "object" && raw.usage !== null
      ? (raw.usage as Record<string, unknown>)
      : typeof response?.usage === "object" && response.usage !== null
        ? (response.usage as Record<string, unknown>)
        : null;

  if (!usage) {
    return null;
  }

  const promptTokens = Number(
    usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? 0,
  );
  const completionTokens = Number(
    usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? 0,
  );

  if (promptTokens <= 0 && completionTokens <= 0) {
    return null;
  }

  const responseId = String(
    raw.responseId ??
      raw.response_id ??
      response?.id ??
      `response-${Date.now()}`,
  );

  return { responseId, promptTokens, completionTokens };
}

function trackVoiceRealtimeUsage({
  sessionId,
  responseId,
  promptTokens,
  completionTokens,
}: {
  sessionId: string;
  responseId: string;
  promptTokens: number;
  completionTokens: number;
}) {
  void fetch("/api/voice/realtime/track-usage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      responseId,
      promptTokens,
      completionTokens,
    }),
  }).catch((error) => {
    console.error("[voice-realtime] Failed to track usage:", error);
  });
}

/**
 * The user's agents, for resolving what the model called them.
 *
 * `activateAgent` is handled inline in the browser, so it cannot use the
 * server-side resolver. Rather than add an endpoint, this reuses the existing
 * `list_agents` app tool through the same relay every other server tool uses.
 * One extra round trip on a rare action, and no second source of truth.
 */
async function fetchVoiceAgents(): Promise<{ id: string; name: string }[]> {
  try {
    const response = await fetch("/api/voice/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: "list_agents", arguments: {} }),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as {
      output?: { agents?: { id?: unknown; name?: unknown }[] };
    };
    return (payload.output?.agents ?? []).flatMap((agent) =>
      typeof agent?.id === "string" && typeof agent?.name === "string"
        ? [{ id: agent.id, name: agent.name }]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * A finished browser run, as the realtime model should hear about it.
 *
 * Compact on purpose: the whole thing is re-read on every later turn, and the
 * model only needs what it will say out loud. `blocked` carries its own next
 * step because the expensive mistake is retrying — the wall is the site's
 * identity check, so a second run hits it identically and bills another
 * browser session to learn nothing.
 */
function describeBrowserOutcome(frame: VoiceBrowserFrame) {
  switch (frame.status) {
    case "done":
      return {
        status: "done",
        summary: frame.summary,
        stepCount: frame.stepCount,
      };
    case "blocked":
      return {
        status: "blocked",
        reason: frame.reason,
        progress: frame.summary,
        note: "The page needed a person and the browser was closed. Say what it asked for and that the site has to be connected once by hand in organization settings. Do NOT start the same run again.",
      };
    case "failed":
      return { status: "failed", error: frame.error };
    default:
      return { status: frame.status };
  }
}

/**
 * Assistant audio is played via WebAudio, which browser echo cancellation does
 * not reliably subtract from the mic signal (AEC is anchored to the WebRTC
 * path). On speakers the model hears its own output, server VAD treats it as
 * user speech, and the session spirals into answering itself. The explicit
 * constraints help where AEC does work; the half-duplex guard below removes
 * the loop deterministically by pausing capture while the assistant speaks.
 * Trade-off: no barge-in, so the guard only runs while the user has
 * interruptions switched off (VoiceSettings.allowInterruptions). With them on,
 * the mic stays open and a headset is the reliable way to avoid echo.
 */
const VOICE_AUDIO_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    // Realtime input is mono; asking for it up front saves the browser a
    // downmix and keeps stereo mics from doubling the uplink.
    channelCount: 1,
  },
};

/**
 * Debounce before unmuting the mic once assistant playback ends. Phone
 * speakers carry an audible tail after isPlaying flips false; unmuting too
 * early feeds that tail to server VAD, which reads it as a user turn and makes
 * the model answer (repeat) itself.
 */
const HALF_DUPLEX_RESUME_DELAY_MS = 400;

/**
 * How long to wait after a tool result before stepping in with our own
 * `response.create`. Long enough for the transport to send the tool output and
 * its own request first (the normal path), short enough that a genuinely
 * silent model is revived before the user notices.
 */
const RESPONSE_RESUME_WATCHDOG_MS = 250;

/**
 * Server errors that reject a single request but leave the session usable.
 * Treating these as fatal tore down a working conversation.
 */
function isRecoverableRealtimeError(error: Error): boolean {
  const message = error.message?.toLowerCase() ?? "";
  return (
    message.includes("active response in progress") ||
    message.includes("conversation_already_has_active_response") ||
    // A cancel that lost the race against the response finishing on its own.
    message.includes("response_cancel_not_active") ||
    message.includes("no active response")
  );
}

function isMessageCompleted(message: UIMessageWithCompleted): boolean {
  if (!message.parts.length) {
    return false;
  }

  return message.parts.every((part) => {
    if (part.type === "text") {
      return part.state === "done" || Boolean(part.text?.trim());
    }
    if (isToolUIPart(part)) {
      return (
        part.state === "output-available" ||
        part.state === "output-error" ||
        part.state === "output-denied"
      );
    }
    return true;
  });
}

export function useOpenAIVoiceChat(props?: VoiceChatOptions): VoiceChatSession {
  const {
    voice = DEFAULT_OPENAI_VOICE,
    context,
    ptt = false,
    autoStart = false,
  } = props || {};
  // Validated before anything reaches the wire; keyed by value so a fresh
  // object from the store with the same content is not a change.
  const settingsKey = JSON.stringify(normalizeVoiceSettings(props?.settings));
  const settings = useMemo<VoiceSettings>(
    () => JSON.parse(settingsKey),
    [settingsKey],
  );
  /**
   * The settings a new session connects with. Frozen while a session is live:
   * they feed `sessionConfig`, and a new `sessionConfig` identity makes
   * useRealtime dispose the store, which would hang up mid-conversation. Live
   * changes travel as a separate `session-update` instead (see below).
   */
  const [connectSettings, setConnectSettings] =
    useState<VoiceSettings>(settings);
  /** What the server was last asked for: drives the half-duplex guard. */
  const [appliedSettings, setAppliedSettings] =
    useState<VoiceSettings>(settings);
  /** A live change waits here while a response is still being spoken. */
  const pendingSettingsRef = useRef<VoiceSettings | null>(null);
  const [settingsPending, setSettingsPending] = useState(false);
  /** The wire fields last sent, to compare with the `session.updated` echo. */
  const expectedWireRef = useRef<
    Parameters<typeof checkSessionConfirmation>[1] | null
  >(null);
  const [sessionConfirmation, setSessionConfirmation] =
    useState<VoiceSessionConfirmation>({ status: "pending" });
  const applyPendingSettingsRef = useRef<() => void>(() => {});
  /** For a manual stop: which item is playing and since when. */
  const lastAudioItemIdRef = useRef<string | null>(null);
  const playbackStartedAtRef = useRef<number | null>(null);

  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isContextLoading, setIsContextLoading] = useState(true);
  const [contextError, setContextError] = useState<Error | null>(null);
  const [preparedContext, setPreparedContext] = useState<{
    key: string;
    voice: string;
    agentId?: string;
    toolMentions: NonNullable<VoiceChatOptions["toolMentions"]>;
    instructions?: string;
    /** Instructions for an opening response the model speaks unprompted. */
    greeting?: string;
    tools: OpenAIRealtimeFunctionTool[];
    toolStatus: VoiceToolStatus;
    toolExecutionMap: VoiceToolExecutionMap;
    /** Whether the session was offered browseWeb/checkBrowserRun. */
    browserAutomation: boolean;
  } | null>(null);

  const { setTheme } = useTheme();
  const [isGuardPaused, setIsGuardPaused] = useState(false);
  /** True between response.created and response.done — see withResumedResponse. */
  const activeResponseRef = useRef(false);
  const resumeWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userMicOffRef = useRef(false);
  const pendingAgentSwitchRef = useRef<string | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  /**
   * Live browser runs, keyed by Kernel session id.
   *
   * `browseWeb` returns the moment the browser exists so the model can speak,
   * which leaves the actual result arriving later. The model collects it with
   * `checkBrowserRun`, and this is where the pending promise waits in between.
   */
  const browserRunsRef = useRef(new Map<string, Promise<VoiceBrowserFrame>>());
  const browserAbortRef = useRef<AbortController | null>(null);
  const [browserPreview, setBrowserPreview] =
    useState<VoiceBrowserFrame | null>(null);
  const sessionIdRef = useRef(generateUUID());
  /**
   * The chat thread this conversation is saved into, and what has already been
   * written to it.
   *
   * Minted here rather than asked for from the server so the id exists before
   * the first turn does — the drawer can link to the thread from the moment
   * anything has been said. The server checks ownership before appending.
   */
  const threadIdRef = useRef(generateUUID());
  const [threadId, setThreadId] = useState<string | null>(null);
  /** Turn id → the parts signature last written, see selectVoiceTurnsToPersist. */
  const persistedTurnsRef = useRef(new Map<string, string>());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushInFlightRef = useRef(false);
  const trackedResponsesRef = useRef(new Set<string>());
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const hasStoppedRef = useRef(false);
  const isStoppingRef = useRef(false);
  const expectedDisconnectRef = useRef(false);
  const previousStatusRef = useRef<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const realtimeRef = useRef<ReturnType<
    typeof experimental_useRealtime
  > | null>(null);
  /**
   * Latency telemetry (`voice.session_ready_ms`): how long the prepare call
   * took, and when `start` asked to connect. Reported once per connect.
   */
  const latencyRef = useRef<{
    prepareMs: number | null;
    connectStartedAt: number | null;
  }>({ prepareMs: null, connectStartedAt: null });
  /** Push-to-talk: whether the talk button is currently held. */
  const pttHeldRef = useRef(false);
  /** The prepared opening line, read from `onEvent`; see `preparedContext`. */
  const greetingRef = useRef<string | undefined>(undefined);
  /** Whether this connect's opening response was requested; reset by `start`. */
  const greetedRef = useRef(false);
  const toolExecutionMapRef = useRef<VoiceToolExecutionMap>({});

  /**
   * Docs use `gateway.experimental_realtime(modelId)` from `@ai-sdk/gateway`.
   * canary.107 throws in browsers ("cannot be used in browsers yet"), so this
   * object mirrors GatewayRealtimeModel (getWebSocketConfig / parse / serialize).
   */
  const realtimeModel = useMemo(() => createBrowserGatewayRealtimeModel(), []);

  const toolMentions = props?.toolMentions ?? [];
  const agentId = props?.agentId;
  const requestedContextKey = useMemo(
    () => JSON.stringify({ voice, agentId, toolMentions, context }),
    [voice, agentId, toolMentions, context],
  );
  const requestedContext = useMemo(
    () => ({
      key: requestedContextKey,
      voice,
      agentId,
      toolMentions,
      context,
    }),
    [requestedContextKey],
  );

  // See realtime-session-config.ts for why this has two layers.
  const sessionConfig = useMemo(
    () =>
      buildRealtimeSessionConfig({
        voice: preparedContext?.voice ?? voice,
        settings: connectSettings,
        instructions: preparedContext?.instructions,
        tools: preparedContext?.tools,
        ptt,
      }),
    [voice, preparedContext, ptt, connectSettings],
  );

  // Only the agent id: this URL is POSTed by the AI SDK's transport with a body
  // we do not control, and that call keeps only the token — the context the
  // route builds for it is discarded. Mentions travel in the prepare call's
  // body instead; in the query they made the URL grow with the user's tool
  // selection until the edge rejected it with a 414.
  const realtimeApi = useMemo(
    () => ({ token: buildVoiceTokenApiUrl(preparedContext?.agentId) }),
    [preparedContext],
  );

  const handleUsageEvent = useCallback(
    (event: Experimental_RealtimeServerEvent) => {
      const usage = extractUsageFromRealtimeEvent(event);
      if (!usage) {
        return;
      }
      if (trackedResponsesRef.current.has(usage.responseId)) {
        return;
      }
      trackedResponsesRef.current.add(usage.responseId);
      trackVoiceRealtimeUsage({
        sessionId: sessionIdRef.current,
        ...usage,
      });
    },
    [],
  );

  const onEvent = useCallback(
    (event: Experimental_RealtimeServerEvent) => {
      if (event.type === "speech-started") {
        setIsUserSpeaking(true);
      }
      if (event.type === "speech-stopped") {
        setIsUserSpeaking(false);
      }
      // Track whether a response is in flight so the resume watchdog does not
      // request a second one. Read the type off the raw event: the SDK union
      // does not cover every server event, and it is inconsistent about dot vs
      // dash naming (extractUsageFromRealtimeEvent does the same).
      const rawType = (event as { type?: string }).type;
      if (rawType === "response.created" || rawType === "response-created") {
        activeResponseRef.current = true;
      }
      if (rawType === "response.done" || rawType === "response-done") {
        activeResponseRef.current = false;
        // A setting changed mid-answer applies before the next one.
        applyPendingSettingsRef.current();
      }
      if (rawType === "audio-delta") {
        const itemId = (event as { itemId?: string }).itemId;
        if (itemId) lastAudioItemIdRef.current = itemId;
      }
      // The provider echoes the full effective session. Compare it with what
      // was sent: TypeScript accepting a field proves nothing about whether
      // the gateway passed it on and OpenAI applied it.
      if (rawType === "session-updated" || rawType === "session.updated") {
        const raw =
          rawType === "session.updated"
            ? event
            : (event as { raw?: unknown }).raw;
        const expected = expectedWireRef.current;
        if (expected) {
          const confirmation = checkSessionConfirmation(raw, expected);
          setSessionConfirmation(confirmation);
          if (confirmation.status === "mismatch") {
            console.warn(
              "[voice-realtime] session settings not confirmed by the server",
              confirmation.fields,
            );
          } else {
            console.info(
              "[voice-realtime] session settings",
              confirmation.status,
            );
          }
        }
      }
      // Speak first: a session prepared with a greeting (the cockpit's) asks
      // for its opening response as soon as the server has the session,
      // without waiting for the microphone. `session-update` was queued on
      // socket open, ahead of this on the transport's ordered send queue, so
      // the reply already has the session's voice. Per-response instructions
      // apply to this one response only.
      if (
        (rawType === "session-created" ||
          rawType === "session.created" ||
          rawType === "session-updated" ||
          rawType === "session.updated") &&
        greetingRef.current &&
        !greetedRef.current
      ) {
        greetedRef.current = true;
        try {
          realtimeRef.current?.sendEvent({
            type: "response-create",
            options: { instructions: greetingRef.current },
          });
        } catch (greetError) {
          console.error(
            "[voice-realtime] failed to request greeting",
            greetError,
          );
        }
      }
      // Server-side rejections (e.g. a response.create sent while a response
      // is still active) surface here and are otherwise indistinguishable from
      // the model simply staying quiet.
      if (event.type === "error") {
        const raw = event as unknown as {
          error?: { type?: string; message?: string; code?: string };
        };
        console.error("[voice-realtime] server error", {
          type: raw.error?.type,
          code: raw.error?.code,
          message: raw.error?.message,
        });
      }
      handleUsageEvent(event);
    },
    [handleUsageEvent],
  );

  const onError = useCallback((nextError: Error) => {
    console.error("[voice-realtime] session error", {
      name: nextError.name,
      message: nextError.message,
    });
    // A rejected request is not the end of the session; surfacing it would
    // replace a working conversation with "close the voice chat and try again".
    if (isRecoverableRealtimeError(nextError)) {
      return;
    }
    if (!expectedDisconnectRef.current) {
      setError(nextError);
    }
    setIsLoading(false);
  }, []);

  /**
   * Returns a tool result and makes sure the model speaks again — but only if
   * nothing else already did.
   *
   * The Realtime API does not resume on its own after a tool result: server
   * VAD only auto-creates responses for the user's *audio* turns, so a
   * function_call_output with no following `response.create` leaves the model
   * silent forever. The transport usually sends that event itself right after
   * it delivers the output.
   *
   * Requesting one unconditionally (as this did first) races that: our call
   * fires before the output is even sent, and one of the two requests then
   * lands on an already-running response and is rejected with
   * "Conversation already has an active response in progress". So this arms a
   * watchdog instead — after the delay it only requests a response when none
   * is active, i.e. when the transport did not take care of it.
   *
   * Every caller must go through this, error paths included: an unanswered
   * function call stays in the conversation history and the model reads it as
   * a still-pending tool for the rest of the session.
   */
  const withResumedResponse = useCallback(<T>(result: T): T => {
    if (resumeWatchdogRef.current != null) {
      clearTimeout(resumeWatchdogRef.current);
    }
    resumeWatchdogRef.current = setTimeout(() => {
      resumeWatchdogRef.current = null;
      const current = realtimeRef.current;
      if (activeResponseRef.current || current?.status !== "connected") {
        return;
      }
      try {
        current.requestResponse();
      } catch (requestError) {
        console.error(
          "[voice-realtime] failed to request response",
          requestError,
        );
      }
    }, RESPONSE_RESUME_WATCHDOG_MS);
    return result;
  }, []);

  /**
   * Start a browser run and answer the model as soon as the browser exists.
   *
   * Deliberately does NOT wait for the run: a browsing task takes 30-120s, and
   * a function call blocked that long leaves the session silent, which reads as
   * a crash. The user is already watching the live view by then, and the model
   * collects the result with `checkBrowserRun`.
   */
  const handleBrowseWeb = useCallback(
    async (args: unknown, toolCallId: string) => {
      const task = (args as { task?: unknown })?.task;
      if (typeof task !== "string" || !task.trim()) {
        return { error: "A task is required to open the browser." };
      }

      browserAbortRef.current ??= new AbortController();
      try {
        const run = await startVoiceBrowserRun({
          task: task.trim(),
          callId: toolCallId,
          signal: browserAbortRef.current.signal,
          onFrame: setBrowserPreview,
        });

        if (run.first.status === "starting" || run.first.status === "running") {
          // Kept until the session ends rather than dropped when it settles:
          // `checkBrowserRun` has to be able to read an ALREADY finished run,
          // which is the common case for a short task.
          browserRunsRef.current.set(run.first.sessionId, run.final);
          return {
            status: "running",
            sessionId: run.first.sessionId,
            note: "The browser is open and the user can see it on screen. Say briefly what you are about to do, then call checkBrowserRun with this sessionId.",
          };
        }
        return describeBrowserOutcome(run.first);
      } catch (error) {
        return {
          error:
            error instanceof VoiceBrowserRunError
              ? error.message
              : "The browser could not be started.",
        };
      }
    },
    [],
  );

  /** Wait for a run started by `browseWeb`, or report that it is still going. */
  const handleCheckBrowserRun = useCallback(async (args: unknown) => {
    const sessionId = (args as { sessionId?: unknown })?.sessionId;
    const pending =
      typeof sessionId === "string"
        ? browserRunsRef.current.get(sessionId)
        : undefined;
    if (!pending) {
      return {
        error:
          "No browser run with that sessionId in this conversation. Start one with browseWeb first.",
      };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(
        () => resolve("timeout"),
        VOICE_BROWSER_CHECK_TIMEOUT_MS,
      );
    });
    try {
      const outcome = await Promise.race([pending, timeout]);
      if (outcome === "timeout") {
        return {
          status: "running",
          note: "Still working. Tell the user what is happening, then call checkBrowserRun again.",
        };
      }
      return describeBrowserOutcome(outcome);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, []);

  const onToolCall = useCallback(
    async ({
      toolCall,
    }: {
      toolCall: { toolCallId: string; toolName: string; args: unknown };
    }) => {
      const { toolCallId, toolName, args } = toolCall;

      if (isDefaultVoiceTool(toolName)) {
        if (toolName === "changeBrowserTheme") {
          const theme = (args as { theme?: string })?.theme;
          if (theme === "light" || theme === "dark") {
            setTheme(theme);
          }
          return withResumedResponse("success");
        }

        if (toolName === "endConversation") {
          await stopRef.current?.();
          setError(null);
          appStore.setState((prev) => ({
            voiceChat: {
              ...prev.voiceChat,
              agentId: undefined,
              isOpen: false,
              context: undefined,
            },
          }));
          // No response requested: the session is going away.
          return "success";
        }

        return withResumedResponse("success");
      }

      // activateAgent: instructions and tools are baked into the session at
      // connect time, so switching agents requires a controlled reconnect.
      // Deferring the stop lets the function-call output reach the socket
      // first; the auto-restart effect reconnects once the new agent's
      // context is prepared. Unlike endConversation, agentId is SET here and
      // the drawer stays open.
      if (isBrowserVoiceAppTool(toolName)) {
        // Browser automation runs through its own streaming route rather than
        // POST /api/voice/tool, because the live-view URL has to reach the
        // panel while the run is still going. See `browser-run-contract.ts`.
        if (toolName === "browseWeb") {
          return withResumedResponse(await handleBrowseWeb(args, toolCallId));
        }
        if (toolName === "checkBrowserRun") {
          return withResumedResponse(await handleCheckBrowserRun(args));
        }
        if (toolName !== "activateAgent") {
          return withResumedResponse({
            error: `Unhandled browser voice tool "${toolName}"`,
          });
        }
        // Browser-target tools never reach the server's zod validation, so a
        // reference the model invented would otherwise be stored verbatim and
        // reconnect the session to nothing. Resolve it against the real roster
        // first, and hand the model the list when nothing matches.
        const reference = (args as { agent?: unknown })?.agent;
        if (typeof reference !== "string" || !reference.trim()) {
          return withResumedResponse({
            error: "An agent name or id is required.",
          });
        }
        const agents = await fetchVoiceAgents();
        const match = matchAgentByReference(agents, reference);
        if (!match) {
          return withResumedResponse({
            error: agents.length
              ? `No agent matches "${reference}". Available: ${agents
                  .map((agent) => agent.name)
                  .join(", ")}.`
              : "This workspace has no agents yet.",
          });
        }
        const agentId = match.id;
        pendingAgentSwitchRef.current = agentId;
        void (async () => {
          await stopRef.current?.();
          appStore.setState((prev) => ({
            voiceChat: {
              ...prev.voiceChat,
              agentId,
              isOpen: true,
            },
          }));
        })();
        return { switching: true };
      }

      const executionTarget = toolExecutionMapRef.current[toolName];
      if (!executionTarget) {
        return withResumedResponse({
          error: `Tool "${toolName}" is not available in this voice session`,
        });
      }

      // `kind` is sent explicitly rather than left to the server to infer. A
      // Composio tool name is neither app-allowlisted nor shaped like an MCP
      // tool id, so name-sniffing would route it to the MCP path.
      const requestBody =
        executionTarget.kind === "app" || executionTarget.kind === "composio"
          ? {
              toolName,
              kind: executionTarget.kind,
              arguments: args,
              callId: toolCallId,
            }
          : {
              toolName,
              kind: "mcp" as const,
              mcpServerId: executionTarget.mcpServerId,
              mcpToolName: executionTarget.toolName,
              arguments: args,
              callId: toolCallId,
            };

      try {
        const response = await fetch("/api/voice/tool", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          return withResumedResponse({
            error:
              payload.error?.message ||
              payload.error ||
              "The tool could not be executed.",
          });
        }

        announceCockpitPushUpdate(toolName, args, payload.output);
        return withResumedResponse(payload.output);
      } catch (toolError) {
        // Never rethrow: an unanswered function call leaves the conversation
        // waiting on it forever (see withResumedResponse).
        return withResumedResponse({
          error:
            toolError instanceof Error
              ? toolError.message
              : "The tool could not be executed.",
        });
      }
    },
    [handleBrowseWeb, handleCheckBrowserRun, setTheme, withResumedResponse],
  );

  const realtime = experimental_useRealtime({
    model: realtimeModel as Parameters<
      typeof experimental_useRealtime
    >[0]["model"],
    api: realtimeApi,
    sessionConfig,
    onEvent,
    onError,
    onToolCall: onToolCall as Parameters<
      typeof experimental_useRealtime
    >[0]["onToolCall"],
  });

  realtimeRef.current = realtime;
  toolExecutionMapRef.current = preparedContext?.toolExecutionMap ?? {};
  greetingRef.current = preparedContext?.greeting;

  // Prepare the agent/MCP context before connecting. A sessionConfig identity
  // change makes useRealtime dispose its current store, so a live session is
  // deliberately frozen until it is explicitly stopped.
  useEffect(() => {
    let cancelled = false;

    if (realtime.status !== "disconnected") {
      return;
    }

    if (preparedContext?.key === requestedContext.key) {
      setIsContextLoading(false);
      return;
    }

    setIsContextLoading(true);
    setContextError(null);
    setBrowserGatewayTeamIdOrSlug(undefined);

    const tokenUrl = buildVoiceTokenApiUrl(requestedContext.agentId);
    const prepareStartedAt = performance.now();

    void (async () => {
      try {
        const response = await fetch(tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionConfig: { voice: requestedContext.voice },
            sessionOnly: true,
            // The server prompt's one language rule follows the preset.
            language: resolveOpenAIVoicePreset(requestedContext.voice).language,
            agentId: requestedContext.agentId,
            mentions: requestedContext.toolMentions,
            // Only the prepare call carries it: its instructions are the ones
            // the session uses (the transport's own token call is discarded).
            ...(requestedContext.context
              ? { context: requestedContext.context }
              : {}),
          }),
        });
        if (!response.ok) {
          throw new Error(
            `Failed to prepare voice session: ${response.status}`,
          );
        }
        if (cancelled) {
          return;
        }
        const payload = (await response.json()) as {
          instructions?: string;
          greeting?: string;
          teamIdOrSlug?: string;
          tools?: OpenAIRealtimeFunctionTool[];
          toolStatus?: VoiceToolStatus;
          toolExecutionMap?: VoiceToolExecutionMap;
          browserAutomation?: boolean;
        };
        if (cancelled) {
          return;
        }
        const toolStatus = payload.toolStatus ?? createEmptyVoiceToolStatus();
        latencyRef.current.prepareMs = Math.round(
          performance.now() - prepareStartedAt,
        );
        setPreparedContext({
          ...requestedContext,
          instructions: payload.instructions,
          greeting: payload.greeting,
          tools: payload.tools ?? [],
          toolStatus,
          toolExecutionMap: payload.toolExecutionMap ?? {},
          browserAutomation: payload.browserAutomation === true,
        });
        setBrowserGatewayTeamIdOrSlug(payload.teamIdOrSlug);
        // Unreachable MCP servers must not block the session: the app-control
        // and browser tools are always present, so this degrades to the
        // toolWarning banner below instead of a contextError that would
        // disable the start button.
        setIsContextLoading(false);
      } catch (nextError) {
        if (cancelled) {
          return;
        }
        setContextError(
          nextError instanceof Error
            ? nextError
            : new Error("Failed to prepare voice session"),
        );
        setIsContextLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [requestedContext, preparedContext?.key, realtime.status]);

  const isActive = realtime.status === "connected";
  // A guard pause is not "mic off": the user still expects to be heard next.
  const isListening = realtime.isCapturing || isGuardPaused;
  const isAssistantSpeaking = realtime.isPlaying;

  // Half-duplex guard (see VOICE_AUDIO_CONSTRAINTS): with interruptions off,
  // mute the mic track while the assistant speaks and unmute shortly after
  // playback ends unless the user turned the mic off themselves. With them on
  // the mic stays open: the server cancels the response on new speech
  // (`interrupt_response`), and the SDK drops the queued audio and truncates
  // the unheard rest on `speech-started`.
  //
  // Muting, not stopping capture: server VAD segments turns from a continuous
  // audio stream, so tearing the stream down and back up leaves its turn state
  // stuck and the session stops answering after one exchange. A disabled track
  // keeps delivering frames (silence), so the stream never breaks.
  //
  // The desired state is derived on every relevant render rather than latched
  // by a one-shot timer, so a missed transition self-heals on the next render.
  const allowInterruptions = appliedSettings.allowInterruptions;
  useEffect(() => {
    if (!isActive) {
      setIsGuardPaused(false);
      return;
    }

    const tracks = audioStreamRef.current?.getAudioTracks() ?? [];
    if (tracks.length === 0) {
      return;
    }

    // Push-to-talk: the button is the only thing that opens the mic, so the
    // guard reduces to "open while held". Nothing to debounce: there is no
    // VAD to mistake a speaker tail for a turn.
    if (ptt) {
      const open = pttHeldRef.current && !userMicOffRef.current;
      for (const track of tracks) {
        track.enabled = open;
      }
      setIsGuardPaused(!open && !userMicOffRef.current);
      return;
    }

    if (allowInterruptions) {
      if (!userMicOffRef.current) {
        for (const track of tracks) {
          track.enabled = true;
        }
      }
      setIsGuardPaused(false);
      return;
    }

    if (realtime.isPlaying) {
      for (const track of tracks) {
        track.enabled = false;
      }
      setIsGuardPaused(true);
      return;
    }

    if (userMicOffRef.current) {
      return;
    }

    // Unmute after a short delay so the speaker tail cannot be picked up as a
    // user turn. Failing to unmute only costs one turn of audio, never the
    // session: the next render re-evaluates this.
    const timer = setTimeout(() => {
      if (userMicOffRef.current || realtimeRef.current?.isPlaying) {
        return;
      }
      for (const track of audioStreamRef.current?.getAudioTracks() ?? []) {
        track.enabled = true;
      }
      setIsGuardPaused(false);
    }, HALF_DUPLEX_RESUME_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isActive, realtime.isPlaying, ptt, allowInterruptions]);

  // Settings lifecycle. While disconnected the next session simply connects
  // with the current settings. Once connected, the server holds what
  // `sessionConfig` carried; later changes are sent as their own
  // `session-update` between two answers, never mid-answer (OpenAI applies
  // speed only between turns, and a VAD change mid-answer would race it).
  useEffect(() => {
    if (realtime.status !== "disconnected") return;
    setConnectSettings((previous) =>
      JSON.stringify(previous) === settingsKey ? previous : settings,
    );
    setAppliedSettings((previous) =>
      JSON.stringify(previous) === settingsKey ? previous : settings,
    );
    pendingSettingsRef.current = null;
    setSettingsPending(false);
  }, [realtime.status, settings, settingsKey]);

  applyPendingSettingsRef.current = () => {
    const next = pendingSettingsRef.current;
    const current = realtimeRef.current;
    if (!next || current?.status !== "connected" || activeResponseRef.current) {
      return;
    }
    pendingSettingsRef.current = null;
    setSettingsPending(false);
    // No voice: OpenAI refuses a voice change once the model has spoken, and
    // a field left out of `session.update` keeps its current value.
    const wire = buildVoiceWireSession({ settings: next, ptt });
    expectedWireRef.current = wire;
    setSessionConfirmation({ status: "pending" });
    try {
      current.sendEvent({
        type: "session-update",
        config: { providerOptions: wire },
      });
      setAppliedSettings(next);
    } catch (updateError) {
      console.error(
        "[voice-realtime] live settings update failed",
        updateError,
      );
    }
  };

  useEffect(() => {
    if (realtime.status !== "connected") return;
    if (JSON.stringify(appliedSettings) === settingsKey) {
      pendingSettingsRef.current = null;
      setSettingsPending(false);
      return;
    }
    pendingSettingsRef.current = settings;
    setSettingsPending(true);
    applyPendingSettingsRef.current();
  }, [realtime.status, settings, settingsKey, appliedSettings]);

  // Where the current answer's audio started, for a manual stop's truncate.
  useEffect(() => {
    playbackStartedAtRef.current = realtime.isPlaying
      ? performance.now()
      : null;
  }, [realtime.isPlaying]);

  /**
   * The stop button: silence the answer now without losing the next turn.
   *
   * Mirrors what the SDK does on `speech-started`: drop the queued audio, and
   * truncate the assistant item to what was actually heard so the model does
   * not believe the user listened to the rest. The response itself is
   * cancelled only while one is running (a cancel without one is an error).
   * The mic and the input buffer are left alone, so whatever the user says
   * next is still heard.
   *
   * The played duration is measured from when `isPlaying` flipped, which lags
   * the real start by a render: the estimate errs short, and a truncate past
   * the end of the item would be rejected.
   */
  const interruptResponse = useCallback(() => {
    const current = realtimeRef.current;
    if (current?.status !== "connected") return;
    try {
      if (current.isPlaying) {
        const startedAt = playbackStartedAtRef.current;
        const itemId = lastAudioItemIdRef.current;
        current.stopPlayback();
        if (itemId && startedAt != null) {
          current.sendEvent({
            type: "conversation-item-truncate",
            itemId,
            contentIndex: 0,
            audioEndMs: Math.max(0, Math.round(performance.now() - startedAt)),
          });
        }
      }
      if (activeResponseRef.current) {
        current.cancelResponse();
      }
    } catch (interruptError) {
      console.error(
        "[voice-realtime] stopping the answer failed",
        interruptError,
      );
    }
  }, []);

  // voice.session_ready_ms: from `start` to a connected session, with the
  // prepare call's own duration alongside (prepare usually runs earlier, as
  // soon as the drawer opens, so it is reported separately rather than summed).
  useEffect(() => {
    const startedAt = latencyRef.current.connectStartedAt;
    if (realtime.status !== "connected" || startedAt == null) return;
    latencyRef.current.connectStartedAt = null;
    const connectMs = Math.round(performance.now() - startedAt);
    const prepareMs = latencyRef.current.prepareMs;
    console.info("[voice-realtime] session ready", { connectMs, prepareMs });
    try {
      analytics.capture("voice_session_ready", {
        session_ready_ms: connectMs,
        prepare_ms: prepareMs,
        context: context ?? "default",
        ptt,
      });
    } catch {
      // Telemetry must never touch the session.
    }
  }, [realtime.status, context, ptt]);

  const isReadyToConnect =
    preparedContext != null && !isContextLoading && contextError == null;
  const sessionError = contextError ?? error;
  const toolStatus =
    preparedContext?.toolStatus ?? createEmptyVoiceToolStatus();
  const toolWarning =
    toolStatus.requested.length > 0 && toolStatus.available.length === 0
      ? "MCP tools are currently unavailable — continuing with app tools only. Reconnect the MCP server to use them."
      : toolStatus.available.length > 0 && toolStatus.unavailable.length > 0
        ? `${toolStatus.unavailable.length} selected MCP tool${toolStatus.unavailable.length === 1 ? " is" : "s are"} unavailable. The conversation will use the remaining tools.`
        : null;

  const messages = useMemo<UIMessageWithCompleted[]>(() => {
    return realtime.messages.map((message) => ({
      ...message,
      completed: isMessageCompleted(message as UIMessageWithCompleted),
    }));
  }, [realtime.messages]);

  // Read through refs so the flusher keeps a stable identity: it is called from
  // a debounce timer and from `stop`, neither of which should re-arm because a
  // word was transcribed.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sessionAgentIdRef = useRef<string | undefined>(undefined);
  sessionAgentIdRef.current = preparedContext?.agentId;

  /**
   * Write whatever completed turns are not in the thread yet.
   *
   * The whole conversation is persisted, so the model never has to decide
   * whether this one is worth keeping — a decision it got wrong in both
   * directions — and anything a tool produced that is not speakable (source
   * links above all) stays reachable in the app afterwards.
   */
  const flushSessionTurns = useCallback(async () => {
    if (flushInFlightRef.current) return;
    const { turns, signatures } = selectVoiceTurnsToPersist(
      messagesRef.current,
      persistedTurnsRef.current,
    );
    if (turns.length === 0) return;

    flushInFlightRef.current = true;
    const saved = await flushVoiceSessionTurns({
      threadId: threadIdRef.current,
      voiceSessionId: sessionIdRef.current,
      agentId: sessionAgentIdRef.current,
      turns,
    });
    flushInFlightRef.current = false;
    // On failure the signatures are deliberately NOT recorded, so the same
    // turns go out again on the next flush.
    if (!saved) return;
    for (const [id, signature] of signatures) {
      persistedTurnsRef.current.set(id, signature);
    }
    setThreadId(threadIdRef.current);
  }, []);

  // Debounced rather than per-message: a turn counts as "completed" as soon as
  // a text part has any text at all, so flushing on every change would write
  // half-spoken sentences and then correct them. Waiting for the stream to go
  // quiet means one write per turn in the normal case.
  useEffect(() => {
    if (messages.length === 0) return;
    if (flushTimerRef.current != null) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      void flushSessionTurns();
    }, VOICE_THREAD_FLUSH_DEBOUNCE_MS);
    return () => {
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
    };
  }, [messages, flushSessionTurns]);

  const stop = useCallback(async () => {
    if (isStoppingRef.current || hasStoppedRef.current) {
      return;
    }

    isStoppingRef.current = true;
    expectedDisconnectRef.current = true;
    setIsGuardPaused(false);
    // The last turn is usually still inside the debounce window when the user
    // hangs up, so flush now rather than lose the end of the conversation. Not
    // awaited: the request carries `keepalive`, and hanging up should not wait
    // on a write the user never sees.
    if (flushTimerRef.current != null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    void flushSessionTurns();
    if (resumeWatchdogRef.current != null) {
      clearTimeout(resumeWatchdogRef.current);
      resumeWatchdogRef.current = null;
    }
    activeResponseRef.current = false;
    // Hanging up has to reach the browser run: aborting the request cancels the
    // inner agent, whose `finally` deletes the Kernel browser. Without this a
    // headful browser keeps billing until Kernel's inactivity timeout reaps it.
    browserAbortRef.current?.abort();
    browserAbortRef.current = null;
    browserRunsRef.current.clear();
    setBrowserPreview(null);
    try {
      realtimeRef.current?.stopAudioCapture();
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
      }
      realtimeRef.current?.disconnect();
      setIsUserSpeaking(false);
      setIsLoading(false);
      hasStoppedRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      isStoppingRef.current = false;
    }
  }, [flushSessionTurns]);

  stopRef.current = stop;

  /** Docs flow: connect() → getUserMedia → startAudioCapture(stream) */
  const start = useCallback(async () => {
    const currentRealtime = realtimeRef.current;
    if (
      currentRealtime == null ||
      currentRealtime.status !== "disconnected" ||
      isLoading ||
      !isReadyToConnect
    ) {
      return;
    }

    hasStoppedRef.current = false;
    setIsLoading(true);
    setError(null);
    trackedResponsesRef.current.clear();
    lastAudioItemIdRef.current = null;
    setSessionConfirmation({ status: "pending" });
    // Exactly what the SDK's own `session-update` on open carries; set before
    // connecting so the `session.updated` echo always has something to match.
    expectedWireRef.current = sessionConfig.providerOptions;
    sessionIdRef.current = generateUUID();
    // A new session is a new conversation — including after an activateAgent
    // handover, where the realtime store starts empty anyway — so it gets its
    // own thread rather than appending to the previous one.
    threadIdRef.current = generateUUID();
    persistedTurnsRef.current.clear();
    setThreadId(null);

    latencyRef.current.connectStartedAt = performance.now();
    pttHeldRef.current = false;
    greetedRef.current = false;
    try {
      await currentRealtime.connect();
      const stream = await navigator.mediaDevices.getUserMedia(
        VOICE_AUDIO_CONSTRAINTS,
      );
      audioStreamRef.current = stream;
      userMicOffRef.current = false;
      if (ptt) {
        // Closed until the talk button is held.
        for (const track of stream.getAudioTracks()) {
          track.enabled = false;
        }
      }
      currentRealtime.startAudioCapture(stream);
      setIsLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setIsLoading(false);
      await stop();
    }
  }, [isLoading, isReadyToConnect, stop, ptt, sessionConfig]);

  /**
   * Push-to-talk press: drop whatever silence the open stream buffered, cut
   * the assistant off if it is speaking, and open the mic. A no-op outside a
   * connected `ptt` session.
   */
  const pushToTalkStart = useCallback(() => {
    const current = realtimeRef.current;
    if (!ptt || current?.status !== "connected" || pttHeldRef.current) return;
    pttHeldRef.current = true;
    try {
      current.clearAudioBuffer();
      if (current.isPlaying) current.stopPlayback();
      if (activeResponseRef.current) current.cancelResponse();
    } catch (pttError) {
      console.error("[voice-realtime] push-to-talk start failed", pttError);
    }
    for (const track of audioStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !userMicOffRef.current;
    }
    setIsGuardPaused(false);
    setIsUserSpeaking(true);
  }, [ptt]);

  /**
   * Push-to-talk release: close the mic, commit what was said as one user
   * turn and ask for the answer. With turn detection off, nothing else would.
   */
  const pushToTalkEnd = useCallback(() => {
    const current = realtimeRef.current;
    if (!ptt || !pttHeldRef.current) return;
    pttHeldRef.current = false;
    for (const track of audioStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = false;
    }
    setIsUserSpeaking(false);
    if (current?.status !== "connected") return;
    try {
      current.commitAudio();
      current.requestResponse();
    } catch (pttError) {
      console.error("[voice-realtime] push-to-talk commit failed", pttError);
    }
  }, [ptt]);

  // autoStart: connect once per mount, as soon as the context prepared is the
  // one requested. Comparing keys rather than reading `isReadyToConnect` alone
  // matters: when the mentions change, this commit still sees the previous
  // context as ready, and starting on it would freeze the stale one in.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (
      !autoStart ||
      autoStartedRef.current ||
      !isReadyToConnect ||
      preparedContext?.key !== requestedContext.key ||
      realtime.status !== "disconnected"
    ) {
      return;
    }
    autoStartedRef.current = true;
    void start();
  }, [
    autoStart,
    isReadyToConnect,
    preparedContext?.key,
    requestedContext.key,
    realtime.status,
    start,
  ]);

  // Auto-restart after an activateAgent switch: once the store change has
  // propagated (new agentId prop) and the prepare effect finished fetching the
  // new agent's instructions/tools, reconnect. A failed prepare surfaces via
  // contextError and leaves the session stopped.
  useEffect(() => {
    if (
      pendingAgentSwitchRef.current == null ||
      realtime.status !== "disconnected" ||
      !isReadyToConnect ||
      preparedContext?.agentId !== pendingAgentSwitchRef.current
    ) {
      return;
    }
    pendingAgentSwitchRef.current = null;
    void start();
  }, [realtime.status, isReadyToConnect, preparedContext?.agentId, start]);

  const startListening = useCallback(async () => {
    try {
      userMicOffRef.current = false;
      const streamHasEnded = audioStreamRef.current
        ?.getAudioTracks()
        .every((track) => track.readyState === "ended");
      if (!audioStreamRef.current || streamHasEnded) {
        audioStreamRef.current = await navigator.mediaDevices.getUserMedia(
          VOICE_AUDIO_CONSTRAINTS,
        );
      }
      // Clear any mute the guard left on the track, otherwise turning the mic
      // back on would restore a silent stream.
      for (const track of audioStreamRef.current.getAudioTracks()) {
        track.enabled = true;
      }
      if (realtimeRef.current?.status === "connected") {
        realtimeRef.current.startAudioCapture(audioStreamRef.current);
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  const stopListening = useCallback(async () => {
    try {
      userMicOffRef.current = true;
      setIsGuardPaused(false);
      realtimeRef.current?.stopAudioCapture();
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
        audioStreamRef.current = null;
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  useEffect(() => {
    if (realtime.status === "connecting") {
      setIsLoading(true);
    } else if (realtime.status === "connected" || realtime.status === "error") {
      setIsLoading(false);
    }
  }, [realtime.status]);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    if (
      previousStatus === "connected" &&
      realtime.status === "disconnected" &&
      !expectedDisconnectRef.current
    ) {
      const disconnectError = new Error(
        "Voice connection closed unexpectedly. Please start the conversation again.",
      );
      console.error("[voice-realtime] unexpected disconnect", {
        previousStatus,
        status: realtime.status,
      });
      setError(disconnectError);
    }
    previousStatusRef.current = realtime.status;
    if (realtime.status === "disconnected") {
      expectedDisconnectRef.current = false;
    }
  }, [realtime.status]);

  useEffect(() => {
    return () => {
      void stopRef.current?.();
    };
  }, []);

  /**
   * Close the panel without touching the run.
   *
   * Only offered for a finished run: while one is live the panel IS the feature,
   * and hiding a headful browser that is still billing is the wrong default.
   */
  const dismissBrowserPreview = useCallback(() => {
    setBrowserPreview(null);
  }, []);

  return {
    isActive,
    isUserSpeaking,
    isAssistantSpeaking,
    isListening,
    isLoading: isLoading || isContextLoading,
    error: sessionError,
    toolStatus,
    toolWarning,
    messages,
    threadId,
    browserAutomationEnabled: preparedContext?.browserAutomation === true,
    browserPreview,
    dismissBrowserPreview,
    start,
    stop,
    startListening,
    stopListening,
    pushToTalkStart,
    pushToTalkEnd,
    interruptResponse,
    sessionConfirmation,
    settingsPending,
    sessionVoice: isActive
      ? resolveOpenAIVoicePreset(preparedContext?.voice).id
      : undefined,
  };
}
