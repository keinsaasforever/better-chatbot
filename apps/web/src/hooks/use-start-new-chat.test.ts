// @vitest-environment jsdom

import { appStore } from "@/app/store";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStartNewChat } from "./use-start-new-chat";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  appStore.setState({ newChatToken: 0 });
});

afterEach(() => {
  appStore.setState({ newChatToken: 0 });
});

describe("useStartNewChat", () => {
  it("resets the home chat in place when the address bar is already '/'", () => {
    const { result } = renderHook(() => useStartNewChat());

    act(() => result.current());

    // The token is the whole reset: bumping it remounts ChatBot, which mints a
    // new thread id. A refresh() here would only re-render the same mounted
    // chat — the double-press bug.
    expect(appStore.getState().newChatToken).toBe(1);
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("also puts the URL back when the first send rewrote it to /chat/<id>", () => {
    // chat-bot's transport replaceState's to the thread URL without leaving
    // "/", so the route is still the home chat even though the path is not.
    window.history.replaceState({}, "", "/chat/thread-1");
    const { result } = renderHook(() => useStartNewChat());

    act(() => result.current());

    expect(appStore.getState().newChatToken).toBe(1);
    expect(push).toHaveBeenCalledWith("/");
  });

  it("navigates home from any other route", () => {
    window.history.replaceState({}, "", "/mcp");
    const { result } = renderHook(() => useStartNewChat());

    act(() => result.current());

    expect(push).toHaveBeenCalledWith("/");
  });

  it("bumps once per press so repeated presses keep opening fresh chats", () => {
    const { result } = renderHook(() => useStartNewChat());

    act(() => result.current());
    act(() => result.current());

    expect(appStore.getState().newChatToken).toBe(2);
  });
});
