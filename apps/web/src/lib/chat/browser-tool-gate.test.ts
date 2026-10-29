import { describe, expect, it } from "vitest";
import {
  resolveBrowserToolSuppression,
  shouldReadBrowserPolicy,
} from "./browser-tool-gate";

const PASSING = {
  planModeActive: false,
  unattended: false,
  kernelConfigured: true,
  toolkitOn: true,
  taskBrowserEnabled: false,
  policyGate: { enabled: true } as const,
};

describe("resolveBrowserToolSuppression", () => {
  it("binds the tool when every gate passes", () => {
    expect(resolveBrowserToolSuppression(PASSING)).toBeNull();
  });

  it("binds the tool on an unattended run whose task opted in", () => {
    expect(
      resolveBrowserToolSuppression({
        ...PASSING,
        unattended: true,
        taskBrowserEnabled: true,
      }),
    ).toBeNull();
  });

  // The whole point of the change: a scheduled run used to be suppressed by
  // `headless`, which really meant "no client-side tools", not "no human".
  it("does not suppress an unattended run for being unattended", () => {
    const reason = resolveBrowserToolSuppression({
      ...PASSING,
      unattended: true,
      taskBrowserEnabled: true,
    });
    expect(reason ?? "").not.toMatch(/headless|unattended/i);
  });

  it("suppresses an unattended run whose task did not opt in", () => {
    expect(
      resolveBrowserToolSuppression({
        ...PASSING,
        unattended: true,
        taskBrowserEnabled: false,
      }),
    ).toBe("scheduled task has browser automation switched off");
  });

  it("reports the org's unattended policy separately from the base one", () => {
    expect(
      resolveBrowserToolSuppression({
        ...PASSING,
        unattended: true,
        taskBrowserEnabled: true,
        policyGate: { enabled: false, reason: "unattended-policy-off" },
      }),
    ).toBe("org policy browser_automation_unattended_enabled is off");
  });

  it("never conflates an unreadable policy with an explicit off", () => {
    const reason = resolveBrowserToolSuppression({
      ...PASSING,
      policyGate: {
        enabled: false,
        reason: "policy-unavailable",
        detail: "connection refused",
      },
    });
    expect(reason).toBe("org policy could not be read: connection refused");
  });

  it("fails closed with no active organization", () => {
    expect(
      resolveBrowserToolSuppression({
        ...PASSING,
        policyGate: { enabled: false, reason: "no-organization" },
      }),
    ).toBe("no active organization (policy fails closed)");
  });

  // Ordering is the part that regresses: a cheap local check must win over a
  // policy result so the log names something the reader can act on.
  it("reports plan mode ahead of every other reason", () => {
    expect(
      resolveBrowserToolSuppression({
        ...PASSING,
        planModeActive: true,
        kernelConfigured: false,
        toolkitOn: false,
        policyGate: { enabled: false, reason: "policy-off" },
      }),
    ).toBe("plan mode");
  });

  it("reports missing configuration ahead of the toolkit and policy", () => {
    expect(
      resolveBrowserToolSuppression({
        ...PASSING,
        kernelConfigured: false,
        toolkitOn: false,
        policyGate: { enabled: false, reason: "policy-off" },
      }),
    ).toBe("KERNEL_API_KEY not set");
  });

  it("reports the task switch ahead of the org policy", () => {
    expect(
      resolveBrowserToolSuppression({
        ...PASSING,
        unattended: true,
        taskBrowserEnabled: false,
        policyGate: { enabled: false, reason: "unattended-policy-off" },
      }),
    ).toBe("scheduled task has browser automation switched off");
  });
});

describe("shouldReadBrowserPolicy", () => {
  it("skips the org read when a cheap check already failed", () => {
    expect(
      shouldReadBrowserPolicy({ ...PASSING, kernelConfigured: false }),
    ).toBe(false);
    expect(
      shouldReadBrowserPolicy({
        ...PASSING,
        unattended: true,
        taskBrowserEnabled: false,
      }),
    ).toBe(false);
  });

  it("pays for the org read only when everything cheap passed", () => {
    expect(shouldReadBrowserPolicy(PASSING)).toBe(true);
  });
});
