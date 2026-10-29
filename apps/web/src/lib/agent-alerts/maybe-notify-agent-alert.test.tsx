// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const { showAgentAlertToast } = vi.hoisted(() => ({
  showAgentAlertToast: vi.fn(),
}));
vi.mock("@/components/agent-alerts/agent-alert-toast", () => ({
  showAgentAlertToast,
}));

const prefs = {
  desktopEnabled: true,
  // Force the in-app widget path (never gated on the flaky "away" heuristic)
  // so these tests exercise the toast navigation + viewing-thread suppression.
  onlyWhenAway: false,
  hideTaskDetails: false,
  weeklyEngagementEnabled: true,
};
vi.mock("@/lib/agent-alerts/prefs-cache", () => ({
  getCachedNotificationPrefs: () => prefs,
}));

import { maybeNotifyAgentAlert } from "./maybe-notify-agent-alert";

const assign = vi.fn();

function stubLocation(pathname: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname, assign },
  });
}

describe("maybeNotifyAgentAlert", () => {
  beforeEach(() => {
    showAgentAlertToast.mockClear();
    assign.mockClear();
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });

  it("hands the toast a navigator that opens the raw chat path (no double /chat prefix)", () => {
    // Viewing a different page than the completed thread.
    stubLocation("/");

    maybeNotifyAgentAlert({ kind: "complete", threadId: "abc123" });

    expect(showAgentAlertToast).toHaveBeenCalledTimes(1);
    const onNavigate = showAgentAlertToast.mock.calls[0]![2] as (
      path: string,
    ) => void;

    // The toast already computes `/chat/<id>` and passes it through. The
    // navigator must use it verbatim — the old wiring re-wrapped it into
    // `/chat//chat/<id>`, which 404'd on Vercel.
    onNavigate("/chat/abc123");
    expect(assign).toHaveBeenCalledWith("/chat/abc123");
  });

  it("stays silent while the user is already viewing that thread", () => {
    stubLocation("/chat/abc123");

    maybeNotifyAgentAlert({ kind: "complete", threadId: "abc123" });

    expect(showAgentAlertToast).not.toHaveBeenCalled();
  });
});
