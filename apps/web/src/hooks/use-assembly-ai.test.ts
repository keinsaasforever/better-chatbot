// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("@/lib/billing/require-credits", () => ({
  requireCredits: () => true,
}));

vi.mock("@/lib/assemblyai/streaming-config", () => ({
  buildAssemblyAIStreamingUrl: () => "wss://assemblyai.test/stream",
  preparePcmChunkForAssemblyAI: () => new ArrayBuffer(0),
}));

import { useAssemblyAI } from "./use-assembly-ai";

class FakeSocket {
  static instances: FakeSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = FakeSocket.CLOSED;
  });

  constructor() {
    FakeSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
}

class FakeAudioContext {
  sampleRate = 16_000;
  destination = {};
  close = vi.fn(async () => {});
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }));
  createScriptProcessor = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  }));
}

function makeStream() {
  const track = { stop: vi.fn() };
  return {
    track,
    stream: { getTracks: () => [track] } as unknown as MediaStream,
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function defineGlobal(target: object, key: string, value: unknown) {
  try {
    Object.defineProperty(target, key, { value, configurable: true });
  } catch {
    (target as Record<string, unknown>)[key] = value;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const getUserMedia = vi.fn();
const fetchMock = vi.fn();

beforeEach(() => {
  FakeSocket.instances = [];
  getUserMedia.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/assemblyai/token") {
      return { ok: true, json: async () => ({ token: "tok" }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", fetchMock);
  defineGlobal(window, "isSecureContext", true);
  defineGlobal(navigator, "mediaDevices", { getUserMedia });
  defineGlobal(navigator, "permissions", undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderDictation() {
  return renderHook(() =>
    useAssemblyAI({ onTranscript: vi.fn(), onCommand: vi.fn() }),
  );
}

describe("useAssemblyAI", () => {
  it("reads as listening as soon as the mic is live and stops fully on toggle", async () => {
    const { track, stream } = makeStream();
    getUserMedia.mockResolvedValue(stream);

    const { result } = renderDictation();

    act(() => {
      result.current.toggleListening();
    });

    // The socket has not opened yet, but the mic is already capturing.
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    expect(result.current.isListening).toBe(true);
    expect(FakeSocket.instances[0].readyState).toBe(FakeSocket.CONNECTING);

    act(() => {
      FakeSocket.instances[0].open();
    });
    expect(result.current.isListening).toBe(true);

    act(() => {
      result.current.toggleListening();
    });

    expect(result.current.isListening).toBe(false);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances[0].send).toHaveBeenCalledWith(
      JSON.stringify({ type: "Terminate" }),
    );
    expect(FakeSocket.instances[0].close).toHaveBeenCalledTimes(1);
  });

  it("stops instead of starting a second session when tapped while connecting", async () => {
    const { track, stream } = makeStream();
    getUserMedia.mockResolvedValue(stream);

    const { result } = renderDictation();

    act(() => {
      result.current.toggleListening();
    });
    await waitFor(() => expect(FakeSocket.instances).toHaveLength(1));
    const socket = FakeSocket.instances[0];

    // Second tap lands before the socket opened.
    act(() => {
      result.current.toggleListening();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(result.current.isListening).toBe(false);

    // A late open on the abandoned socket must not revive the session.
    act(() => {
      socket.readyState = FakeSocket.OPEN;
      socket.onopen?.();
    });
    expect(result.current.isListening).toBe(false);
  });

  it("releases the mic when stopped while the token is still being fetched", async () => {
    const { track, stream } = makeStream();
    getUserMedia.mockResolvedValue(stream);
    const token = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    fetchMock.mockImplementation((url: string) =>
      url === "/api/assemblyai/token"
        ? token.promise
        : Promise.resolve({ ok: true, json: async () => ({}) }),
    );

    const { result } = renderDictation();

    act(() => {
      result.current.toggleListening();
    });
    await waitFor(() => expect(result.current.isListening).toBe(true));

    act(() => {
      result.current.toggleListening();
    });
    expect(result.current.isListening).toBe(false);
    expect(track.stop).toHaveBeenCalled();

    await act(async () => {
      token.resolve({ ok: true, json: async () => ({ token: "tok" }) });
      await flush();
    });

    // The cancelled start must not open a socket behind the user's back.
    expect(FakeSocket.instances).toHaveLength(0);
    expect(result.current.isListening).toBe(false);
  });

  it("releases the mic when the mic is still being requested at stop time", async () => {
    const { track, stream } = makeStream();
    const mic = deferred<MediaStream>();
    getUserMedia.mockReturnValue(mic.promise);

    const { result } = renderDictation();

    act(() => {
      result.current.toggleListening();
    });
    // Permission prompt still open; the user taps again to abort.
    act(() => {
      result.current.toggleListening();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    await act(async () => {
      mic.resolve(stream);
      await flush();
    });

    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/assemblyai/token",
      expect.anything(),
    );
    expect(result.current.isListening).toBe(false);
  });
});
