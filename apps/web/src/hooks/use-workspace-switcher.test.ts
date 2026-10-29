// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceSwitcher } from "./use-workspace-switcher";

const list = vi.fn();
const setActive = vi.fn();
const toastError = vi.fn();

vi.mock("auth/client", () => ({
  authClient: {
    organization: {
      list: (...args: unknown[]) => list(...args),
      setActive: (...args: unknown[]) => setActive(...args),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: (...a: unknown[]) => toastError(...a) },
}));

// The hook only needs the key back; the message catalog is exercised by the
// component tests that render it for real.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const reload = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  list.mockResolvedValue({ data: [{ id: "org-1", name: "Acme" }] });
  // jsdom cannot navigate, and `window.location` is not writable; stubbing the
  // global is how we observe the reload the switch depends on.
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

describe("useWorkspaceSwitcher", () => {
  it("does nothing when the target is already the active workspace", async () => {
    const { result } = renderHook(() => useWorkspaceSwitcher("org-1"));

    await act(async () => {
      await result.current.switchWorkspace("org-1");
    });

    expect(setActive).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads after switching, so every org-scoped cache is dropped", async () => {
    setActive.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useWorkspaceSwitcher("org-1"));

    await act(async () => {
      await result.current.switchWorkspace("org-2");
    });

    expect(setActive).toHaveBeenCalledWith({ organizationId: "org-2" });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed switch and stays on the page", async () => {
    setActive.mockResolvedValue({ error: { message: "nope" } });
    const { result } = renderHook(() => useWorkspaceSwitcher("org-1"));

    await act(async () => {
      await result.current.switchWorkspace("org-2");
    });

    expect(toastError).toHaveBeenCalledWith("nope");
    expect(reload).not.toHaveBeenCalled();
    // The caller must be able to try again rather than being stuck "switching".
    await waitFor(() => expect(result.current.isSwitching).toBe(false));
  });
});
