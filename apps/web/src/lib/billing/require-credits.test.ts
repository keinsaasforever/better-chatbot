// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { appStore } from "@/app/store";
import { openUsageLimitDialog, requireCredits } from "./require-credits";

// The store is module-global: without this an over-limit test leaks
// `openUsageLimit: true` into every test that follows.
afterEach(() => {
  appStore.setState({ usageLimit: null, openUsageLimit: false });
});

describe("requireCredits", () => {
  it("blocks and opens the modal when the workspace is over its limit", () => {
    appStore.setState({
      usageLimit: { isOverLimit: true, usage: 100_000, includedUsage: 100_000 },
      openUsageLimit: false,
    });

    expect(requireCredits()).toBe(false);
    expect(appStore.getState().openUsageLimit).toBe(true);
  });

  it("fails open when no status has been seeded", () => {
    // The load-bearing invariant. `/accept-invitation/:id` renders the sidebar
    // and header but not `UsageLimitSync`, so the status stays null there — a
    // null must never swallow a click, because there is no modal mounted to
    // explain why nothing happened.
    appStore.setState({ usageLimit: null, openUsageLimit: false });

    expect(requireCredits()).toBe(true);
    expect(appStore.getState().openUsageLimit).toBe(false);
  });

  it("allows the action when the workspace still has credits", () => {
    appStore.setState({
      usageLimit: { isOverLimit: false, usage: 12, includedUsage: 100_000 },
      openUsageLimit: false,
    });

    expect(requireCredits()).toBe(true);
    expect(appStore.getState().openUsageLimit).toBe(false);
  });

  it("reads the status at call time, not at import time", () => {
    appStore.setState({ usageLimit: null, openUsageLimit: false });
    expect(requireCredits()).toBe(true);

    appStore.setState({
      usageLimit: { isOverLimit: true, usage: 100_000, includedUsage: 100_000 },
    });
    expect(requireCredits()).toBe(false);
  });
});

describe("openUsageLimitDialog", () => {
  it("opens the modal regardless of the seeded status", () => {
    // The backstop path: the server answered 402, so a stale "not over limit"
    // status must not keep the modal shut.
    appStore.setState({
      usageLimit: { isOverLimit: false, usage: 0, includedUsage: 100_000 },
      openUsageLimit: false,
    });

    openUsageLimitDialog();

    expect(appStore.getState().openUsageLimit).toBe(true);
  });
});
