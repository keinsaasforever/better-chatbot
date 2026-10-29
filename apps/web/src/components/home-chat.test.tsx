// @vitest-environment jsdom

import { appStore } from "@/app/store";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeChat } from "./home-chat";

const { mounted } = vi.hoisted(() => ({ mounted: vi.fn() }));

// ChatBot pulls in the whole chat stack (transport, store, MCP, i18n). All this
// test needs is whether it stayed mounted, which is what decides if a "New
// chat" press actually starts one: the thread id is minted per mount.
vi.mock("@/components/chat-bot", () => ({
  // Named, and capitalized: `react-hooks/rules-of-hooks` only recognizes hooks
  // inside a function it can see is a component.
  default: function MockChatBot() {
    const instanceId = useRef(Math.random().toString(36).slice(2));
    useEffect(() => {
      mounted(instanceId.current);
    }, []);
    return <div data-testid="chat-bot">{instanceId.current}</div>;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  appStore.setState({ newChatToken: 0 });
});

afterEach(() => {
  cleanup();
  appStore.setState({ newChatToken: 0 });
});

describe("HomeChat", () => {
  it("remounts the chat when a new chat is requested", () => {
    render(<HomeChat />);
    const first = screen.getByTestId("chat-bot").textContent;

    act(() => {
      appStore.setState((prev) => ({ newChatToken: prev.newChatToken + 1 }));
    });

    expect(mounted).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("chat-bot").textContent).not.toBe(first);
  });

  it("keeps the chat mounted through unrelated store updates", () => {
    // The reverse failure is the one `use-stable-thread-id` was written for: a
    // chat that rebuilds on background churn re-runs every threadId-keyed
    // effect and reloads the app in front of the user.
    render(<HomeChat />);
    const first = screen.getByTestId("chat-bot").textContent;

    act(() => {
      appStore.setState({ currentThreadId: "thread-1", threadList: [] });
    });

    expect(mounted).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("chat-bot").textContent).toBe(first);
  });
});
