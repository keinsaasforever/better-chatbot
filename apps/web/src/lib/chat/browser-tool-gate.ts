import type { BrowserAutomationGate } from "lib/ai/routing/service";

/**
 * Why the browser-automation tool is not bound on this request, or `null` when
 * it is.
 *
 * Six independent conditions collapse into one absent tool, and that has
 * already cost a debugging session, so this names the FIRST one that failed and
 * the route logs it verbatim. Extracted from the chat route (rather than left
 * inline) so the ordering can be tested without standing up a 1700-line
 * handler — the ordering is the part that regresses.
 *
 * Cheapest first: everything here is a boolean the caller already has, and the
 * caller only pays for the org-policy read when every cheap check passed. That
 * is why the gate result comes in as an argument rather than being fetched.
 */
export type BrowserToolGateInput = {
  planModeActive: boolean;
  unattended: boolean;
  kernelConfigured: boolean;
  toolkitOn: boolean;
  /**
   * `scheduled_task.browser_automation_enabled` for the task driving this run.
   * Only consulted when `unattended`; an interactive run has no task row.
   */
  taskBrowserEnabled: boolean;
  /**
   * The org gate result: `resolveUnattendedBrowserGate` when unattended,
   * `resolveBrowserAutomationGate` otherwise. `null` means the caller skipped
   * the read because an earlier check already failed.
   */
  policyGate: BrowserAutomationGate | null;
};

export function resolveBrowserToolSuppression(
  input: BrowserToolGateInput,
): string | null {
  if (input.planModeActive) return "plan mode";
  if (!input.kernelConfigured) return "KERNEL_API_KEY not set";
  if (!input.toolkitOn) {
    return "toolkit not in client's allowedAppDefaultToolkit";
  }
  // Checked before the org policy so the schedule's own switch, the one its
  // owner controls, is the reason reported when it is the reason.
  if (input.unattended && !input.taskBrowserEnabled) {
    return "scheduled task has browser automation switched off";
  }
  if (input.policyGate?.enabled === false) {
    switch (input.policyGate.reason) {
      case "no-organization":
        return "no active organization (policy fails closed)";
      case "policy-off":
        return "org policy browser_automation_enabled is off";
      case "unattended-policy-off":
        return "org policy browser_automation_unattended_enabled is off";
      default:
        // Never conflated with an explicit "off": an admin who already enabled
        // the policy must be able to see that the read itself failed.
        return `org policy could not be read: ${
          input.policyGate.detail ?? "unknown error"
        }`;
    }
  }
  return null;
}

/**
 * Whether the caller should pay for the org-policy read.
 *
 * Mirrors the cheap checks above so the two cannot drift: if any of them would
 * suppress the tool anyway, the read is wasted.
 */
export function shouldReadBrowserPolicy(
  input: Omit<BrowserToolGateInput, "policyGate">,
): boolean {
  return resolveBrowserToolSuppression({ ...input, policyGate: null }) === null;
}
