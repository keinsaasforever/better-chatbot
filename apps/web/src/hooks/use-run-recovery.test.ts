// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  RECOVERY_POLL_MS,
  STREAM_STALE_MS,
  useRunRecovery,
} from "./use-run-recovery";

const { loadLatest } = vi.hoisted(() => ({ loadLatest: vi.fn() }));

// The real module pulls in the DB and auth; the hook only needs the one
// action, and the factory keeps the rest from loading.
vi.mock("@/app/api/chat/actions", () => ({
  loadLatestThreadMessagesAction: loadLatest,
}));

vi.mock("swr", () => ({ mutate: vi.fn() }));

const user = (id: string, runStatus?: string): UIMessage =>
  ({
    id,
    role: "user",
    parts: [{ type: "text", text: id }],
    metadata: runStatus ? { runStatus } : undefined,
  }) as UIMessage;

const assistant = (id: string, runStatus?: string): UIMessage =>
  ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: id }],
    metadata: runStatus ? { runStatus } : undefined,
  }) as UIMessage;

const networkError = () => new TypeError("Load failed");

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(initial: {
  messages: UIMessage[];
  status?: "ready" | "streaming" | "submitted" | "error";
  error?: Error;
  resume?: boolean;
}) {
  const calls: string[] = [];
  const messagesRef = { current: initial.messages };
  const chatStateRef = {
    current: { status: initial.status ?? "ready", error: initial.error },
  };
  const lastStreamActivityRef = { current: Date.now() };
  const attemptResume = vi.fn(async () => {
    calls.push("resume");
    return initial.resume ?? false;
  });
  const stop = vi.fn(async () => {
    calls.push("stop");
  });
  const setMessages = vi.fn((update: unknown) => {
    calls.push("setMessages");
    messagesRef.current =
      typeof update === "function"
        ? (update as (prev: UIMessage[]) => UIMessage[])(messagesRef.current)
        : (update as UIMessage[]);
  });
  const clearError = vi.fn(() => {
    calls.push("clearError");
    chatStateRef.current = { ...chatStateRef.current, error: undefined };
  });
  const sendMessage = vi.fn(async () => {
    calls.push("sendMessage");
  });
  const regenerate = vi.fn(async () => {
    calls.push("regenerate");
  });
  return {
    calls,
    messagesRef,
    chatStateRef,
    lastStreamActivityRef,
    attemptResume,
    stop,
    setMessages,
    clearError,
    sendMessage,
    regenerate,
  };
}

function render(harness: Harness, error?: Error, enabled = true) {
  return renderHook(
    ({ error: currentError }) =>
      useRunRecovery({
        threadId: "thread-1",
        enabled,
        error: currentError,
        messagesRef: harness.messagesRef,
        chatStateRef: harness.chatStateRef,
        lastStreamActivityRef: harness.lastStreamActivityRef,
        attemptResume: harness.attemptResume,
        stop: harness.stop as never,
        setMessages: harness.setMessages as never,
        clearError: harness.clearError,
        sendMessage: harness.sendMessage as never,
        regenerate: harness.regenerate as never,
      }),
    { initialProps: { error } },
  );
}

const flush = async () => {
  // Each await inside the hook needs a microtask turn.
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe("useRunRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadLatest.mockReset();
    setVisibility("visible");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("swaps in the persisted answer and clears the error once the run ended", async () => {
    const original = [user("u0"), assistant("a0"), user("u1"), assistant("a1")];
    const harness = makeHarness({
      messages: original,
      status: "error",
      error: networkError(),
    });
    loadLatest.mockResolvedValue([
      assistant("a0", "completed"),
      user("u1", "completed"),
      assistant("a1", "completed"),
    ]);

    const { result } = render(harness);
    let recovered = false;
    await act(async () => {
      recovered = await result.current.recoverRun();
    });

    expect(recovered).toBe(true);
    expect(harness.calls).toEqual([
      "resume",
      "stop",
      "setMessages",
      "clearError",
    ]);
    expect(harness.messagesRef.current.map((m) => m.id)).toEqual([
      "u0",
      "a0",
      "u1",
      "a1",
    ]);
    // Older history stayed the same objects; only the turn was replaced.
    expect(harness.messagesRef.current[0]).toBe(original[0]);
    expect(harness.messagesRef.current[1]).toBe(original[1]);
    expect(harness.messagesRef.current[3]).not.toBe(original[3]);
    expect(harness.messagesRef.current[3].metadata).toEqual({
      runStatus: "completed",
    });
    expect(harness.regenerate).not.toHaveBeenCalled();
  });

  test("never reads the database when the live stream could be resumed", async () => {
    const harness = makeHarness({
      messages: [user("u1")],
      status: "error",
      error: networkError(),
      resume: true,
    });

    const { result } = render(harness);
    await act(async () => {
      await result.current.recoverRun();
    });

    expect(loadLatest).not.toHaveBeenCalled();
    expect(harness.stop).not.toHaveBeenCalled();
  });

  test("polls while the server is still running, then settles", async () => {
    const harness = makeHarness({
      messages: [user("u1"), assistant("a1")],
      status: "error",
      error: networkError(),
    });
    loadLatest
      .mockResolvedValueOnce([user("u1", "running")])
      .mockResolvedValueOnce([user("u1", "completed")])
      .mockResolvedValue([
        user("u1", "completed"),
        assistant("a1", "completed"),
      ]);

    const { result } = render(harness);
    let done: Promise<boolean> | undefined;
    await act(async () => {
      done = result.current.recoverRun();
      await flush();
    });
    expect(result.current.recoveryState).toBe("running");
    expect(harness.clearError).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_POLL_MS + 1);
      await flush();
    });
    expect(loadLatest).toHaveBeenCalledTimes(2);
    expect(harness.clearError).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_POLL_MS + 1);
      await flush();
    });
    expect(await done).toBe(true);
    expect(loadLatest).toHaveBeenCalledTimes(3);
    expect(harness.clearError).toHaveBeenCalledTimes(1);
    expect(result.current.recoveryState).toBeUndefined();
  });

  test("stops polling while the tab is hidden", async () => {
    const harness = makeHarness({
      messages: [user("u1")],
      status: "error",
      error: networkError(),
    });
    loadLatest.mockResolvedValue([user("u1", "running")]);

    const { result } = render(harness);
    let done: Promise<boolean> | undefined;
    await act(async () => {
      done = result.current.recoverRun();
      await flush();
    });
    setVisibility("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RECOVERY_POLL_MS + 1);
      await flush();
    });

    expect(await done).toBe(false);
    expect(loadLatest).toHaveBeenCalledTimes(1);
  });

  test("leaves an unsent turn alone and lets Retry regenerate it", async () => {
    const harness = makeHarness({
      messages: [user("u0"), assistant("a0"), user("u1")],
      status: "error",
      error: networkError(),
    });
    loadLatest.mockResolvedValue([user("u0"), assistant("a0", "completed")]);

    const { result } = render(harness);
    await act(async () => {
      result.current.handleRetry();
      await flush();
    });

    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.setMessages).not.toHaveBeenCalled();
    expect(harness.calls).toEqual(["resume", "clearError", "regenerate"]);
  });

  test("re-sends a tool result the server never received", async () => {
    const pending = {
      type: "tool-python-execution",
      toolCallId: "call-1",
      state: "input-available",
      input: {},
    };
    const clientAnswer = {
      ...assistant("a1"),
      parts: [{ ...pending, state: "output-available", output: {} }],
    } as UIMessage;
    const harness = makeHarness({
      messages: [user("u1"), clientAnswer],
      status: "error",
      error: networkError(),
    });
    loadLatest.mockResolvedValue([
      user("u1", "completed"),
      { ...assistant("a1", "completed"), parts: [pending] },
    ]);

    const { result } = render(harness);
    await act(async () => {
      result.current.handleRetry();
      await flush();
    });

    expect(harness.setMessages).not.toHaveBeenCalled();
    expect(harness.sendMessage).toHaveBeenCalledWith();
    expect(harness.regenerate).not.toHaveBeenCalled();
  });

  test("does not abort a request the user started during the read", async () => {
    const harness = makeHarness({
      messages: [user("u1")],
      status: "error",
      error: networkError(),
    });
    loadLatest.mockImplementation(async () => {
      // A new send landed while the read was in flight.
      harness.messagesRef.current = [user("u1"), user("u2")];
      return [user("u1", "completed"), assistant("a1", "completed")];
    });

    const { result } = render(harness);
    let recovered = true;
    await act(async () => {
      recovered = await result.current.recoverRun();
    });

    expect(recovered).toBe(false);
    expect(harness.stop).not.toHaveBeenCalled();
    expect(harness.setMessages).not.toHaveBeenCalled();
  });

  test("recovers on its own when a connection error surfaces while visible", async () => {
    const harness = makeHarness({
      messages: [user("u1")],
      status: "error",
    });
    loadLatest.mockResolvedValue([
      user("u1", "completed"),
      assistant("a1", "completed"),
    ]);

    const { rerender } = render(harness);
    expect(loadLatest).not.toHaveBeenCalled();

    harness.chatStateRef.current = {
      status: "error",
      error: networkError(),
    };
    await act(async () => {
      rerender({ error: networkError() });
      await flush();
    });

    expect(loadLatest).toHaveBeenCalledTimes(1);
    expect(harness.clearError).toHaveBeenCalledTimes(1);
  });

  test("ignores a server error: only connection failures self-recover", async () => {
    const harness = makeHarness({ messages: [user("u1")], status: "error" });

    const { rerender } = render(harness);
    await act(async () => {
      rerender({ error: new Error("Internal error") });
      await flush();
    });

    expect(loadLatest).not.toHaveBeenCalled();
    expect(harness.attemptResume).not.toHaveBeenCalled();
  });

  test("recovers a stale stream when the tab comes back", async () => {
    const harness = makeHarness({
      messages: [user("u1"), assistant("a1")],
      status: "streaming",
    });
    harness.lastStreamActivityRef.current = Date.now() - STREAM_STALE_MS - 1;
    loadLatest.mockResolvedValue([
      user("u1", "completed"),
      assistant("a1", "completed"),
    ]);

    render(harness);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
    });

    expect(harness.calls).toEqual([
      "resume",
      "stop",
      "setMessages",
      "clearError",
    ]);
  });

  test("leaves a healthy stream alone when the tab comes back", async () => {
    const harness = makeHarness({
      messages: [user("u1"), assistant("a1")],
      status: "streaming",
    });

    render(harness);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await flush();
    });

    expect(harness.attemptResume).not.toHaveBeenCalled();
    expect(loadLatest).not.toHaveBeenCalled();
  });

  test("Retry on a persisted terminal state regenerates", async () => {
    const harness = makeHarness({
      messages: [user("u1", "failed")],
      status: "ready",
    });
    loadLatest.mockResolvedValue([user("u1", "failed")]);

    const { result } = render(harness);
    await act(async () => {
      result.current.handleRetry();
      await flush();
    });

    expect(harness.regenerate).toHaveBeenCalledTimes(1);
  });
});
