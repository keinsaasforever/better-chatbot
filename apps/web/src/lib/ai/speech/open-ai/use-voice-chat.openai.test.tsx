// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const realtimeMock = vi.hoisted(() => {
  const state = {
    status: "disconnected",
    messages: [],
    events: [],
    isCapturing: false,
    isPlaying: false,
  };
  const methods = {
    connect: vi.fn(async () => {
      state.status = "connected";
    }),
    disconnect: vi.fn(() => {
      state.status = "disconnected";
    }),
    addToolOutput: vi.fn(),
    sendEvent: vi.fn(),
    sendTextMessage: vi.fn(),
    sendAudio: vi.fn(),
    commitAudio: vi.fn(),
    clearAudioBuffer: vi.fn(),
    requestResponse: vi.fn(),
    cancelResponse: vi.fn(),
    startAudioCapture: vi.fn(() => {
      state.isCapturing = true;
    }),
    stopAudioCapture: vi.fn(() => {
      state.isCapturing = false;
    }),
    stopPlayback: vi.fn(),
  };

  return {
    state,
    methods,
    latestOptions: null as any,
    setTheme: vi.fn(),
  };
});

vi.mock("@ai-sdk/react", () => ({
  experimental_useRealtime: (options: unknown) => {
    realtimeMock.latestOptions = options;
    // Return a fresh wrapper on every render, matching the SDK behavior that
    // previously caused the app's cleanup effects to disconnect the session.
    return { ...realtimeMock.state, ...realtimeMock.methods };
  },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: realtimeMock.setTheme }),
}));

import { useOpenAIVoiceChat } from "./use-voice-chat.openai";

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

function createStream() {
  const track = {
    readyState: "live",
    enabled: true,
    stop: vi.fn(() => {
      track.readyState = "ended";
    }),
  };
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;

  return { stream, track };
}

describe("useOpenAIVoiceChat", () => {
  // The mic track the hook receives, so tests can assert the guard's mute state.
  let micTrack: ReturnType<typeof createStream>["track"];

  beforeEach(() => {
    realtimeMock.state.status = "disconnected";
    realtimeMock.state.messages = [];
    realtimeMock.state.events = [];
    realtimeMock.state.isCapturing = false;
    realtimeMock.state.isPlaying = false;
    realtimeMock.latestOptions = null;
    realtimeMock.setTheme.mockReset();
    Object.values(realtimeMock.methods).forEach((method) => method.mockClear());

    const { stream, track } = createStream();
    micTrack = track;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          instructions: "Be helpful.",
          teamIdOrSlug: "keinsaas",
          tools: [],
          toolStatus: { requested: [], available: [], unavailable: [] },
          toolExecutionMap: {},
        }),
      ),
    );
  });

  it("does not disconnect when playback state causes a rerender", async () => {
    const { result, rerender, unmount } = renderHook(() =>
      useOpenAIVoiceChat({ voice: "ash" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start();
    });

    realtimeMock.state.isPlaying = true;
    rerender();
    realtimeMock.state.isPlaying = false;
    rerender();

    // Neither disconnecting nor tearing down capture may happen on a
    // playback-driven rerender; the guard only mutes the track.
    expect(realtimeMock.methods.disconnect).not.toHaveBeenCalled();
    expect(realtimeMock.methods.stopAudioCapture).not.toHaveBeenCalled();

    unmount();

    expect(realtimeMock.methods.disconnect).toHaveBeenCalledTimes(1);
    expect(realtimeMock.methods.stopAudioCapture).toHaveBeenCalledTimes(1);
  });

  it("with interruptions off, mutes the mic while the assistant speaks and unmutes afterwards", async () => {
    const { result, rerender } = renderHook(() =>
      useOpenAIVoiceChat({
        voice: "ash",
        settings: { allowInterruptions: false },
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });

    expect(realtimeMock.methods.startAudioCapture).toHaveBeenCalledTimes(1);
    expect(micTrack.enabled).toBe(true);

    // Assistant speaking: the track goes silent so server VAD cannot hear the
    // model's own output, but the session still reports itself as listening.
    await act(async () => {
      realtimeMock.state.isPlaying = true;
      rerender();
    });
    expect(micTrack.enabled).toBe(false);
    expect(result.current.isListening).toBe(true);

    // Playback ends: the track unmutes after the debounce.
    await act(async () => {
      realtimeMock.state.isPlaying = false;
      rerender();
    });
    await waitFor(() => expect(micTrack.enabled).toBe(true), { timeout: 2000 });

    // The regression that made the session deaf after one turn: capture must
    // never be torn down and restarted, or server VAD loses its turn state.
    expect(realtimeMock.methods.stopAudioCapture).not.toHaveBeenCalled();
    expect(realtimeMock.methods.startAudioCapture).toHaveBeenCalledTimes(1);
  });

  // Barge-in: the mic has to hear the user over the answer, otherwise the
  // server never sees speech-started and nothing can interrupt.
  it("keeps the mic open while the assistant speaks when interruptions are allowed", async () => {
    const { result, rerender } = renderHook(() =>
      useOpenAIVoiceChat({ voice: "jarvis" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      realtimeMock.state.isPlaying = true;
      rerender();
    });
    expect(micTrack.enabled).toBe(true);
    expect(
      realtimeMock.latestOptions.sessionConfig.providerOptions.audio.input
        .turn_detection.interrupt_response,
    ).toBe(true);
  });

  it("stops the answer by hand without losing the next turn", async () => {
    const { result, rerender } = renderHook(() =>
      useOpenAIVoiceChat({ voice: "jarvis" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      realtimeMock.latestOptions.onEvent({ type: "response-created" });
      realtimeMock.latestOptions.onEvent({
        type: "audio-delta",
        itemId: "item_answer",
        delta: "",
      });
      realtimeMock.state.isPlaying = true;
      rerender();
    });

    act(() => result.current.interruptResponse?.());

    expect(realtimeMock.methods.stopPlayback).toHaveBeenCalledTimes(1);
    expect(realtimeMock.methods.cancelResponse).toHaveBeenCalledTimes(1);
    expect(realtimeMock.methods.sendEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "conversation-item-truncate",
        itemId: "item_answer",
        contentIndex: 0,
      }),
    );
    // The next utterance must still be heard.
    expect(micTrack.enabled).toBe(true);
    expect(realtimeMock.methods.clearAudioBuffer).not.toHaveBeenCalled();
    expect(realtimeMock.methods.stopAudioCapture).not.toHaveBeenCalled();
  });

  it("does not cancel a response that already finished", async () => {
    const { result } = renderHook(() =>
      useOpenAIVoiceChat({ voice: "jarvis" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      realtimeMock.latestOptions.onEvent({ type: "response-created" });
      realtimeMock.latestOptions.onEvent({ type: "response-done" });
    });

    act(() => result.current.interruptResponse?.());
    expect(realtimeMock.methods.cancelResponse).not.toHaveBeenCalled();
  });

  it("applies a settings change between answers, without the voice and without reconnecting", async () => {
    const { result, rerender } = renderHook(
      (props: { speed: number }) =>
        useOpenAIVoiceChat({ voice: "jarvis", settings: props }),
      { initialProps: { speed: 1.1 } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });
    const sessionConfigAtConnect = realtimeMock.latestOptions.sessionConfig;
    await act(async () => {
      realtimeMock.latestOptions.onEvent({ type: "response-created" });
    });

    // Mid-answer: queued, nothing sent.
    await act(async () => {
      rerender({ speed: 1.3 });
    });
    const sessionUpdates = () =>
      realtimeMock.methods.sendEvent.mock.calls.filter(
        ([event]) => (event as { type: string }).type === "session-update",
      );
    expect(sessionUpdates()).toHaveLength(0);
    expect(result.current.settingsPending).toBe(true);

    // The answer ends: the change goes out.
    await act(async () => {
      realtimeMock.latestOptions.onEvent({ type: "response-done" });
    });
    expect(sessionUpdates()).toHaveLength(1);
    const update = sessionUpdates()[0][0] as {
      config: {
        providerOptions: { audio: { output: Record<string, unknown> } };
      };
    };
    expect(update.config.providerOptions.audio.output).toEqual({ speed: 1.3 });
    // A new sessionConfig identity would make useRealtime hang up.
    expect(realtimeMock.latestOptions.sessionConfig).toBe(
      sessionConfigAtConnect,
    );
    expect(realtimeMock.methods.disconnect).not.toHaveBeenCalled();
  });

  it("reports whether the server confirmed the settings it was sent", async () => {
    const { result } = renderHook(() =>
      useOpenAIVoiceChat({ voice: "jarvis" }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });
    const sent = realtimeMock.latestOptions.sessionConfig.providerOptions;

    await act(async () => {
      realtimeMock.latestOptions.onEvent({
        type: "session-updated",
        raw: { type: "session.updated", session: sent },
      });
    });
    expect(result.current.sessionConfirmation).toEqual({ status: "confirmed" });

    await act(async () => {
      realtimeMock.latestOptions.onEvent({
        type: "session-updated",
        raw: {
          type: "session.updated",
          session: {
            ...sent,
            audio: { ...sent.audio, output: { voice: "cedar", speed: 1 } },
          },
        },
      });
    });
    expect(result.current.sessionConfirmation).toEqual({
      status: "mismatch",
      fields: ["audio.output.speed"],
    });
  });

  it("keeps the mic closed after playback when the user turned it off", async () => {
    const { result, rerender } = renderHook(() =>
      useOpenAIVoiceChat({ voice: "ash" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      realtimeMock.state.isPlaying = true;
      rerender();
    });
    await act(async () => {
      await result.current.stopListening();
    });
    await act(async () => {
      realtimeMock.state.isPlaying = false;
      rerender();
    });

    // stopListening tears the stream down for real, and the guard must not
    // revive it. The wait must outlast the unmute debounce or this passes
    // vacuously before the timer would have fired.
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(realtimeMock.methods.startAudioCapture).toHaveBeenCalledTimes(1);
    expect(realtimeMock.methods.stopAudioCapture).toHaveBeenCalledTimes(1);
  });

  it("waits for the agent context before opening the realtime connection", async () => {
    let resolveContext: (value: Response) => void;
    const contextPromise = new Promise<Response>((resolve) => {
      resolveContext = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(contextPromise));

    const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.start();
    });
    expect(realtimeMock.methods.connect).not.toHaveBeenCalled();

    await act(async () => {
      resolveContext!(response({ instructions: "Be helpful." }));
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start();
    });
    expect(realtimeMock.methods.connect).toHaveBeenCalledTimes(1);
  });

  it("keeps capture alive while a server tool call is running", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          instructions: "Be helpful.",
          tools: [
            {
              type: "function",
              name: "lookupCustomer",
              description: "Find Twenty deals",
              parameters: {
                type: "object",
                properties: { id: { type: "string" } },
                required: ["id"],
              },
            },
          ],
          toolStatus: {
            requested: [
              {
                serverId: "server-1",
                serverName: "Twenty",
                toolName: "findDeals",
              },
            ],
            available: [
              {
                serverId: "server-1",
                serverName: "Twenty",
                toolName: "findDeals",
                exposedName: "lookupCustomer",
              },
            ],
            unavailable: [],
          },
          toolExecutionMap: {
            lookupCustomer: {
              mcpServerId: "server-1",
              mcpServerName: "Twenty",
              toolName: "findDeals",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({ ok: true, output: { answer: "done" } }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.start();
    });

    expect(realtimeMock.latestOptions.sessionConfig.tools).toEqual([
      expect.objectContaining({ name: "lookupCustomer", type: "function" }),
    ]);

    let toolOutput: unknown;
    await act(async () => {
      toolOutput = await realtimeMock.latestOptions.onToolCall({
        toolCall: {
          toolCallId: "call-1",
          toolName: "lookupCustomer",
          args: { id: "customer-1" },
        },
      });
    });

    expect(toolOutput).toEqual({ answer: "done" });
    // The Realtime API does not resume after a tool result on its own, so the
    // watchdog steps in — but only after giving the transport its chance.
    expect(realtimeMock.methods.requestResponse).not.toHaveBeenCalled();
    await waitFor(
      () =>
        expect(realtimeMock.methods.requestResponse).toHaveBeenCalledTimes(1),
      { timeout: 2000 },
    );
    expect(realtimeMock.methods.stopAudioCapture).not.toHaveBeenCalled();
    expect(realtimeMock.methods.startAudioCapture).toHaveBeenCalledTimes(1);
    expect(realtimeMock.methods.disconnect).not.toHaveBeenCalled();

    act(() => {
      realtimeMock.latestOptions.onEvent({ type: "speech-started" });
    });
    expect(result.current.isUserSpeaking).toBe(true);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/voice/tool",
      expect.objectContaining({
        // `kind` is sent explicitly so the server never has to infer the
        // executor from the tool name — a Composio tool looks like neither an
        // app tool nor an MCP tool id.
        body: JSON.stringify({
          toolName: "lookupCustomer",
          kind: "mcp",
          mcpServerId: "server-1",
          mcpToolName: "findDeals",
          arguments: { id: "customer-1" },
          callId: "call-1",
        }),
      }),
    );
  });

  it("answers a failing tool call instead of throwing, and still resumes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          instructions: "Be helpful.",
          tools: [],
          toolStatus: { requested: [], available: [], unavailable: [] },
          toolExecutionMap: {
            list_agents: { kind: "app", toolName: "list_agents" },
          },
        }),
      )
      .mockResolvedValueOnce(
        response({ ok: false, error: { message: "boom" } }, 500),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });

    let toolOutput: unknown;
    await act(async () => {
      // Must not reject: an unanswered function call leaves the conversation
      // waiting on it forever, which is what killed the session.
      toolOutput = await realtimeMock.latestOptions.onToolCall({
        toolCall: { toolCallId: "call-1", toolName: "list_agents", args: {} },
      });
    });

    expect(toolOutput).toEqual({ error: "boom" });
    await waitFor(
      () =>
        expect(realtimeMock.methods.requestResponse).toHaveBeenCalledTimes(1),
      { timeout: 2000 },
    );
  });

  it("lets the transport resume on its own without a second response.create", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          instructions: "Be helpful.",
          tools: [],
          toolStatus: { requested: [], available: [], unavailable: [] },
          toolExecutionMap: {
            list_agents: { kind: "app", toolName: "list_agents" },
          },
        }),
      )
      .mockResolvedValueOnce(response({ ok: true, output: { agents: [] } }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await realtimeMock.latestOptions.onToolCall({
        toolCall: { toolCallId: "call-1", toolName: "list_agents", args: {} },
      });
      // The transport answers the call itself, as it normally does.
      realtimeMock.latestOptions.onEvent({ type: "response.created" });
    });

    // Requesting a second response here is what the server rejects with
    // "Conversation already has an active response in progress".
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(realtimeMock.methods.requestResponse).not.toHaveBeenCalled();
  });

  it("keeps the session usable when a response request is rejected", async () => {
    const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });

    act(() => {
      realtimeMock.latestOptions.onError(
        new Error(
          "Conversation already has an active response in progress: resp_1. Wait until the response is finished before creating a new one.",
        ),
      );
    });
    expect(result.current.error).toBeNull();

    act(() => {
      realtimeMock.latestOptions.onError(new Error("WebSocket closed"));
    });
    expect(result.current.error?.message).toBe("WebSocket closed");
  });

  it("does not request a response when the conversation is ending", async () => {
    const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await realtimeMock.latestOptions.onToolCall({
        toolCall: {
          toolCallId: "call-1",
          toolName: "endConversation",
          args: {},
        },
      });
    });

    // Must outlast the watchdog window, or this passes before it could fire.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(realtimeMock.methods.requestResponse).not.toHaveBeenCalled();
  });

  // Previously this blocked the session outright. Unreachable MCP servers are
  // common (introspection timeouts) and the app-control and browser tools are
  // always present, so the session must still start and only warn.
  it("still starts, with a warning, when no selected MCP tool is available", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          instructions: "Be helpful.",
          tools: [],
          toolStatus: {
            requested: [
              {
                serverId: "server-1",
                serverName: "Twenty",
                toolName: "findDeals",
              },
            ],
            available: [],
            unavailable: [
              {
                serverId: "server-1",
                serverName: "Twenty",
                toolName: "findDeals",
              },
            ],
          },
          toolExecutionMap: {},
        }),
      ),
    );

    const { result } = renderHook(() =>
      useOpenAIVoiceChat({
        voice: "ash",
        toolMentions: [
          {
            type: "mcpTool",
            serverId: "server-1",
            serverName: "Twenty",
            name: "findDeals",
            description: "Find deals",
          },
        ],
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.toolWarning).toMatch(/unavailable/);

    await act(async () => {
      await result.current.start();
    });
    expect(realtimeMock.methods.connect).toHaveBeenCalledTimes(1);
  });

  /**
   * The whole conversation is saved, so the model never decides whether this
   * one is worth keeping — and a web search's source links, which cannot be
   * spoken, stay reachable in the app afterwards.
   */
  describe("persisting the conversation", () => {
    it("files completed turns into a thread and exposes its id", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        response({
          instructions: "Be helpful.",
          tools: [],
          toolStatus: { requested: [], available: [], unavailable: [] },
          toolExecutionMap: {},
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { result, rerender } = renderHook(() =>
        useOpenAIVoiceChat({ voice: "ash" }),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        await result.current.start();
      });

      expect(result.current.threadId).toBeNull();

      await act(async () => {
        realtimeMock.state.messages = [
          {
            id: "msg_1",
            role: "user",
            parts: [
              { type: "text", text: "Was steht heute an?", state: "done" },
            ],
          },
        ] as never;
        rerender();
      });

      await waitFor(
        () =>
          expect(fetchMock).toHaveBeenCalledWith(
            "/api/voice/session-thread",
            expect.anything(),
          ),
        { timeout: 4000 },
      );

      const call = fetchMock.mock.calls.find(
        ([url]) => url === "/api/voice/session-thread",
      );
      const body = JSON.parse((call?.[1] as { body: string }).body);
      expect(body.turns).toEqual([
        expect.objectContaining({ id: "msg_1", role: "user" }),
      ]);
      expect(body.threadId).toEqual(expect.any(String));

      await waitFor(() => expect(result.current.threadId).toBe(body.threadId));
    });

    it("keeps turns unsent when the write fails, and does not claim a thread", async () => {
      const fetchMock = vi.fn().mockImplementation((url: string) =>
        url === "/api/voice/session-thread"
          ? Promise.resolve(response({ error: "nope" }, 500))
          : Promise.resolve(
              response({
                instructions: "Be helpful.",
                tools: [],
                toolStatus: { requested: [], available: [], unavailable: [] },
                toolExecutionMap: {},
              }),
            ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { result, rerender } = renderHook(() =>
        useOpenAIVoiceChat({ voice: "ash" }),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        await result.current.start();
      });

      await act(async () => {
        realtimeMock.state.messages = [
          {
            id: "msg_1",
            role: "user",
            parts: [{ type: "text", text: "hallo", state: "done" }],
          },
        ] as never;
        rerender();
      });

      await waitFor(
        () =>
          expect(
            fetchMock.mock.calls.filter(
              ([url]) => url === "/api/voice/session-thread",
            ),
          ).toHaveLength(1),
        { timeout: 4000 },
      );

      // A failed background save must not be reported as a thread the user can
      // open, and the turn stays queued for the next flush.
      expect(result.current.threadId).toBeNull();
    });
  });
  /**
   * The session config is the hearing and speed contract with the realtime
   * model. Both layers are pinned: the SDK's normalized fields, and the wire
   * `audio` block in providerOptions that carries what the SDK has no field
   * for (eagerness, interrupt, noise reduction).
   */
  describe("realtime session tuning", () => {
    it("uses semantic VAD, near-field noise reduction and the better transcriber", async () => {
      const { result } = renderHook(() => useOpenAIVoiceChat());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const config = realtimeMock.latestOptions.sessionConfig;
      // The default preset is jarvis, which speaks with cedar.
      expect(config.voice).toBe("cedar");
      expect(config.turnDetection).toEqual({ type: "semantic-vad" });
      expect(config.inputAudioTranscription).toEqual({
        model: "gpt-4o-transcribe",
        prompt: expect.stringContaining("keinsaas"),
      });
      // The owner switches languages mid-conversation: never pin one.
      expect(config.inputAudioTranscription.language).toBeUndefined();
      expect(config.providerOptions.audio).toEqual({
        input: {
          transcription: config.inputAudioTranscription,
          noise_reduction: { type: "near_field" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "medium",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: "cedar", speed: 1.1 },
      });
    });

    it("asks the browser for a mono mic", async () => {
      const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        await result.current.start();
      });

      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: expect.objectContaining({
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }),
      });
    });

    it("sends the cockpit context with the prepare call only when set", async () => {
      const { result, unmount } = renderHook(() =>
        useOpenAIVoiceChat({ voice: "ash", context: "cockpit" }),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      const [, init] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(String(init?.body))).toEqual(
        expect.objectContaining({ sessionOnly: true, context: "cockpit" }),
      );
      unmount();

      vi.mocked(fetch).mockClear();
      const plain = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
      await waitFor(() => expect(plain.result.current.isLoading).toBe(false));
      const [, plainInit] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(String(plainInit?.body))).not.toHaveProperty("context");
    });

    it("sends the preset's default language with the prepare call", async () => {
      const jarvis = renderHook(() => useOpenAIVoiceChat({ voice: "jarvis" }));
      await waitFor(() => expect(jarvis.result.current.isLoading).toBe(false));
      const [, jarvisInit] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(String(jarvisInit?.body))).toEqual(
        expect.objectContaining({ language: "en" }),
      );
      expect(
        realtimeMock.latestOptions.sessionConfig.inputAudioTranscription.prompt,
      ).toMatch(/^Mostly English/);
      jarvis.unmount();

      vi.mocked(fetch).mockClear();
      const marin = renderHook(() => useOpenAIVoiceChat({ voice: "marin" }));
      await waitFor(() => expect(marin.result.current.isLoading).toBe(false));
      const [, marinInit] = vi.mocked(fetch).mock.calls[0];
      expect(JSON.parse(String(marinInit?.body))).toEqual(
        expect.objectContaining({ language: "de" }),
      );
    });

    it("speaks the prepared greeting first, once per connect", async () => {
      vi.mocked(fetch).mockResolvedValue(
        response({
          instructions: "Be helpful.",
          greeting: 'Say exactly "Hi Paul Sir."',
          tools: [],
          toolStatus: { requested: [], available: [], unavailable: [] },
          toolExecutionMap: {},
        }),
      );
      const { result } = renderHook(() =>
        useOpenAIVoiceChat({ voice: "ash", context: "cockpit" }),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        await result.current.start();
      });
      expect(realtimeMock.methods.sendEvent).not.toHaveBeenCalled();

      act(() => {
        realtimeMock.latestOptions.onEvent({ type: "session-created" });
        // The confirmation of our own session-update must not greet twice.
        realtimeMock.latestOptions.onEvent({ type: "session-updated" });
      });
      expect(realtimeMock.methods.sendEvent).toHaveBeenCalledTimes(1);
      expect(realtimeMock.methods.sendEvent).toHaveBeenCalledWith({
        type: "response-create",
        options: { instructions: 'Say exactly "Hi Paul Sir."' },
      });
    });

    it("connects on its own once autoStart is set, and only once", async () => {
      const { result, rerender } = renderHook(
        ({ autoStart }) => useOpenAIVoiceChat({ voice: "ash", autoStart }),
        { initialProps: { autoStart: false } },
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(realtimeMock.methods.connect).not.toHaveBeenCalled();

      rerender({ autoStart: true });
      await waitFor(() =>
        expect(realtimeMock.methods.connect).toHaveBeenCalledTimes(1),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // A hang-up does not dial again by itself.
      await act(async () => {
        await result.current.stop();
      });
      rerender({ autoStart: true });
      expect(realtimeMock.methods.connect).toHaveBeenCalledTimes(1);
    });

    it("waits for the user when the session has no greeting", async () => {
      const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        await result.current.start();
      });
      act(() => {
        realtimeMock.latestOptions.onEvent({ type: "session-created" });
      });
      expect(realtimeMock.methods.sendEvent).not.toHaveBeenCalled();
      expect(realtimeMock.methods.requestResponse).not.toHaveBeenCalled();
    });

    it("drives turns by hand in push-to-talk mode", async () => {
      const { result } = renderHook(() =>
        useOpenAIVoiceChat({ voice: "ash", ptt: true }),
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      const config = realtimeMock.latestOptions.sessionConfig;
      expect(config.turnDetection).toEqual({ type: "disabled" });
      expect(config.providerOptions.audio.input.turn_detection).toBeNull();

      await act(async () => {
        await result.current.start();
      });
      // Closed until the button is held.
      expect(micTrack.enabled).toBe(false);

      act(() => result.current.pushToTalkStart?.());
      expect(realtimeMock.methods.clearAudioBuffer).toHaveBeenCalledTimes(1);
      expect(micTrack.enabled).toBe(true);
      expect(result.current.isUserSpeaking).toBe(true);

      act(() => result.current.pushToTalkEnd?.());
      expect(micTrack.enabled).toBe(false);
      expect(realtimeMock.methods.commitAudio).toHaveBeenCalledTimes(1);
      expect(realtimeMock.methods.requestResponse).toHaveBeenCalledTimes(1);
      expect(result.current.isUserSpeaking).toBe(false);
    });

    it("ignores the push-to-talk controls in a VAD session", async () => {
      const { result } = renderHook(() => useOpenAIVoiceChat({ voice: "ash" }));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      await act(async () => {
        await result.current.start();
      });

      act(() => {
        result.current.pushToTalkStart?.();
        result.current.pushToTalkEnd?.();
      });
      expect(realtimeMock.methods.commitAudio).not.toHaveBeenCalled();
      expect(realtimeMock.methods.clearAudioBuffer).not.toHaveBeenCalled();
    });
  });
});
