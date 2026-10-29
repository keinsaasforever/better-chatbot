// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSandboxKeepalive } from "./use-sandbox-keepalive";

const HEARTBEAT_MS = 60_000;
const IDLE_TIMEOUT_MS = 15 * 60_000;
const SUSPEND_AFTER_HIDDEN_MS = 45_000;

let fetchMock: ReturnType<typeof vi.fn>;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function calledPaths(): string[] {
  return fetchMock.mock.calls.map((call) => String(call[0]));
}

function extendCalls(): string[] {
  return calledPaths().filter((path) => path.endsWith("/extend"));
}

function pauseCalls(): string[] {
  return calledPaths().filter((path) => path.endsWith("/pause"));
}

function render() {
  return renderHook(() =>
    useSandboxKeepalive({ sbxId: "sbx_1", enabled: true }),
  );
}

describe("useSandboxKeepalive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("extends while the tab is visible and recently active", () => {
    render();

    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS + 1));

    expect(extendCalls()).toEqual(["/api/sandbox/sbx_1/extend"]);
  });

  test("does not extend while the tab is hidden", () => {
    const { unmount } = render();

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS * 3));

    expect(extendCalls()).toHaveLength(0);
    unmount();
  });

  test("stops extending once the idle window has passed", () => {
    render();

    // Advance past the idle window without any interaction. This is the leak
    // that was billing a left-open tab all night.
    act(() => void vi.advanceTimersByTime(IDLE_TIMEOUT_MS + HEARTBEAT_MS));
    const beforeIdle = extendCalls().length;

    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS * 5));

    expect(extendCalls().length).toBe(beforeIdle);
  });

  test("interaction inside the idle window keeps the sandbox alive", () => {
    const { result } = render();

    act(() => void vi.advanceTimersByTime(IDLE_TIMEOUT_MS - HEARTBEAT_MS));
    act(() => result.current.markActive());
    const beforeReset = extendCalls().length;

    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS * 3));

    expect(extendCalls().length).toBeGreaterThan(beforeReset);
  });

  test("suspends the preview and pauses after the tab stays hidden", () => {
    const { result } = render();

    expect(result.current.previewActive).toBe(true);

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(SUSPEND_AFTER_HIDDEN_MS + 1));

    // previewActive false is what unmounts the iframe — without that, an app
    // that polls keeps auto-resuming the sandbox from the background tab.
    expect(result.current.previewActive).toBe(false);
    expect(pauseCalls()).toContain("/api/sandbox/sbx_1/pause");
  });

  test("a brief tab switch does not suspend the preview", () => {
    const { result } = render();

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(SUSPEND_AFTER_HIDDEN_MS / 2));
    act(() => setVisibility("visible"));
    act(() => void vi.advanceTimersByTime(SUSPEND_AFTER_HIDDEN_MS));

    expect(result.current.previewActive).toBe(true);
    expect(pauseCalls()).toHaveLength(0);
  });

  test("resume() brings a suspended preview back", () => {
    const { result } = render();

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(SUSPEND_AFTER_HIDDEN_MS + 1));
    expect(result.current.previewActive).toBe(false);

    act(() => result.current.resume());

    expect(result.current.previewActive).toBe(true);
  });

  test("resume() does not immediately re-pause the sandbox", () => {
    // The keepalive effect's cleanup pauses the sandbox, so if `previewActive`
    // were one of its dependencies, resuming would tear the effect down and
    // pause the sandbox the user just asked to bring back.
    const { result } = render();

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(SUSPEND_AFTER_HIDDEN_MS + 1));
    const pausesBeforeResume = pauseCalls().length;

    act(() => result.current.resume());
    act(() => setVisibility("visible"));

    expect(pauseCalls().length).toBe(pausesBeforeResume);
    expect(result.current.previewActive).toBe(true);
  });

  test("keeps extending after a resume", () => {
    const { result } = render();

    act(() => setVisibility("hidden"));
    act(() => void vi.advanceTimersByTime(SUSPEND_AFTER_HIDDEN_MS + 1));
    act(() => result.current.resume());
    act(() => setVisibility("visible"));

    const before = extendCalls().length;
    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS + 1));

    expect(extendCalls().length).toBeGreaterThan(before);
  });

  test("pauses the sandbox on unmount", () => {
    const { unmount } = render();

    act(() => unmount());

    expect(pauseCalls()).toContain("/api/sandbox/sbx_1/pause");
  });

  test("pauses the sandbox on pagehide", () => {
    render();

    act(() => void window.dispatchEvent(new Event("pagehide")));

    expect(pauseCalls()).toContain("/api/sandbox/sbx_1/pause");
  });

  test("does nothing at all when disabled", () => {
    renderHook(() => useSandboxKeepalive({ sbxId: null, enabled: false }));

    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS * 3));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
