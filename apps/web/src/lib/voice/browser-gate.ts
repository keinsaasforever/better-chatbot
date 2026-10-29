import "server-only";
import { resolveBrowserAutomationGate } from "lib/ai/routing/service";
import {
  resolveBrowserToolSuppression,
  shouldReadBrowserPolicy,
} from "lib/chat/browser-tool-gate";
import { IS_KERNEL_CONFIGURED } from "lib/kernel/client";

export type VoiceBrowserActor = {
  userId: string;
  organizationId: string | null;
};

/**
 * Whether the voice session may drive a browser, and if not, why.
 *
 * Split out from `browser-run.ts` so the session route can ask the question
 * without pulling in the inner-agent tool factory, and so the answer is
 * testable without mocking one.
 *
 * Reuses the chat route's gate rather than restating it, so the two surfaces
 * cannot drift on what "browser automation is enabled" means. Two inputs are
 * pinned rather than passed:
 *
 * - `toolkitOn: true`. Voice has no tool picker — the drawer's tools dropdown
 *   renders a read-only list with no handlers — so there is no per-user toggle
 *   to consult, and the org AI policy is the only control. Passing `false`
 *   would disable the feature outright; omitting it would break the shared
 *   gate's ordering.
 * - `unattended: false`. A voice session is a person talking, by definition.
 *
 * Fails closed, because `resolveBrowserAutomationGate` does.
 */
export async function resolveVoiceBrowserSuppression(
  actor: VoiceBrowserActor,
): Promise<string | null> {
  const gateInput = {
    planModeActive: false,
    unattended: false,
    kernelConfigured: IS_KERNEL_CONFIGURED,
    toolkitOn: true,
    taskBrowserEnabled: false,
  };
  const policyGate = shouldReadBrowserPolicy(gateInput)
    ? await resolveBrowserAutomationGate({
        organizationId: actor.organizationId,
        userId: actor.userId,
      })
    : null;
  return resolveBrowserToolSuppression({ ...gateInput, policyGate });
}
