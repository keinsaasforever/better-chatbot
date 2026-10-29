// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

import { useDesktopBrowserSignIn } from "./use-desktop-browser-sign-in";

describe("useDesktopBrowserSignIn", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: restoring the absent-bridge default
    delete (window as { desktop?: unknown }).desktop;
  });

  it("is unavailable in a browser without the desktop bridge", async () => {
    const { result } = renderHook(() =>
      useDesktopBrowserSignIn({ page: "sign-in" }),
    );
    expect(result.current.available).toBe(false);
    await act(async () => {
      expect(await result.current.start("google")).toBe(false);
    });
    expect(result.current.pending).toBe(false);
  });

  it("stays unavailable on a desktop build without the auth bridge", () => {
    (window as { desktop?: unknown }).desktop = { platform: "win32" };
    const { result } = renderHook(() =>
      useDesktopBrowserSignIn({ page: "sign-in" }),
    );
    expect(result.current.available).toBe(false);
  });

  it("hands the sign-in to the desktop shell and waits for the browser", async () => {
    const startBrowserSignIn = vi.fn().mockResolvedValue({ ok: true });
    let fail: ((failure: { reason: string }) => void) | undefined;
    const unsubscribe = vi.fn();
    (window as { desktop?: unknown }).desktop = {
      auth: {
        startBrowserSignIn,
        onBrowserSignInFailed: (
          callback: (failure: { reason: string }) => void,
        ) => {
          fail = callback;
          return unsubscribe;
        },
      },
    };

    const { result, unmount } = renderHook(() =>
      useDesktopBrowserSignIn({
        page: "sign-up",
        callbackUrl: "/accept-invitation/abc",
      }),
    );
    expect(result.current.available).toBe(true);

    await act(async () => {
      expect(await result.current.start("google")).toBe(true);
    });
    expect(startBrowserSignIn).toHaveBeenCalledWith({
      page: "sign-up",
      provider: "google",
      callbackUrl: "/accept-invitation/abc",
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      result.current.reopen();
    });
    expect(startBrowserSignIn).toHaveBeenCalledTimes(2);

    act(() => {
      fail?.({ reason: "expired" });
    });
    expect(toastError).toHaveBeenCalledWith("handoffExpired");
    expect(result.current.pending).toBe(false);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("recovers when the shell rejects the request", async () => {
    (window as { desktop?: unknown }).desktop = {
      auth: {
        startBrowserSignIn: vi.fn().mockRejectedValue(new Error("nope")),
        onBrowserSignInFailed: () => () => {},
      },
    };
    const { result } = renderHook(() =>
      useDesktopBrowserSignIn({ page: "sign-in" }),
    );
    await act(async () => {
      await result.current.start("github");
    });
    expect(result.current.pending).toBe(false);
    expect(toastError).toHaveBeenCalledWith("handoffFailed");
  });
});
