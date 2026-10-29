import {
  type DeterministicRoute,
  type OrganizationRoutingPolicy,
  type RouteSignals,
  type RoutingCandidate,
  RoutingPolicyError,
} from "./types";

export function isCandidateEligible(
  candidate: RoutingCandidate,
  signals: RouteSignals,
  policy: OrganizationRoutingPolicy = {},
): boolean {
  if (!candidate.active) return false;
  // A zero value is not a usable free-price marker in this catalog. It means
  // the controlled deployment price has not been configured yet.
  if (
    candidate.inputPriceMicrosPerMillion <= 0 ||
    candidate.outputPriceMicrosPerMillion <= 0
  ) {
    return false;
  }
  if (candidate.dataRetention === "unknown") return false;
  if (
    policy.allowedDeploymentIds &&
    !policy.allowedDeploymentIds.has(candidate.deploymentId)
  ) {
    return false;
  }
  if (signals.requiresTools && !candidate.supportsTools) return false;
  if (signals.requiresVision && !candidate.supportsVision) return false;
  if (candidate.contextTokens < signals.minimumContextTokens) return false;
  if (
    signals.requiredRetention === "zero" &&
    candidate.dataRetention !== "zero"
  ) {
    return false;
  }
  if (signals.requiredRegion && candidate.region !== signals.requiredRegion) {
    return false;
  }
  if (
    policy.allowedRegions?.length &&
    (!candidate.region || !policy.allowedRegions.includes(candidate.region))
  ) {
    return false;
  }
  if (
    policy.maxInputPriceMicrosPerMillion != null &&
    candidate.inputPriceMicrosPerMillion > policy.maxInputPriceMicrosPerMillion
  ) {
    return false;
  }
  if (
    policy.maxOutputPriceMicrosPerMillion != null &&
    candidate.outputPriceMicrosPerMillion >
      policy.maxOutputPriceMicrosPerMillion
  ) {
    return false;
  }
  return true;
}

/**
 * Picks the model for a turn: the one the thread is already on when that is
 * still allowed, otherwise the best task fit.
 *
 * Task fit is recomputed from every message, so scoring each turn from scratch
 * moved threads between models mid-conversation - and because the prompt cache
 * is keyed per provider *and* model, each of those moves re-sent the whole
 * history at full price to a model that had never seen it. A thread therefore
 * routes once, on its first turn, and stays there.
 *
 * `pinnedChatModel` is checked against the same hard eligibility as any other
 * candidate, so the pin cannot outlive the org's allowlist, a deactivated
 * deployment, or a turn that needs vision, tools, or a bigger context window
 * than the pinned model has. Those are the only switches left, and they are
 * the ones where staying put would fail the request outright.
 */
export function selectDeterministicRoute(input: {
  candidates: RoutingCandidate[];
  signals: RouteSignals;
  policy?: OrganizationRoutingPolicy;
  /** The model this thread's previous turn ran on, if it had one. */
  pinnedChatModel?: { provider?: string; model?: string } | null;
}): DeterministicRoute {
  const eligible = input.candidates.filter((candidate) =>
    isCandidateEligible(candidate, input.signals, input.policy),
  );

  const pinned = input.pinnedChatModel
    ? eligible.find(
        (candidate) =>
          candidate.chatModel.provider === input.pinnedChatModel?.provider &&
          candidate.chatModel.model === input.pinnedChatModel?.model,
      )
    : undefined;
  if (pinned) {
    const profile = pinned.profiles.find(
      (entry) => entry.taskKey === input.signals.taskKey,
    );
    return {
      candidate: pinned,
      taskKey: input.signals.taskKey,
      taskScore: profile?.score ?? 0,
      reasonCode: `thread_pinned:${input.signals.taskKey}`,
    };
  }

  const ranked = eligible
    .map((candidate) => {
      const profile = candidate.profiles.find(
        (entry) => entry.taskKey === input.signals.taskKey,
      );
      return {
        candidate,
        score: profile?.score ?? 0,
        tieBreakPriority: profile?.tieBreakPriority ?? 0,
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.tieBreakPriority !== left.tieBreakPriority) {
        return right.tieBreakPriority - left.tieBreakPriority;
      }
      return left.candidate.deploymentId.localeCompare(
        right.candidate.deploymentId,
      );
    });

  const winner = ranked[0];
  if (!winner) {
    throw new RoutingPolicyError(
      "NO_ELIGIBLE_MODEL",
      "No organization-approved model meets this request's requirements.",
    );
  }

  return {
    candidate: winner.candidate,
    taskKey: input.signals.taskKey,
    taskScore: winner.score,
    reasonCode: `task_fit:${input.signals.taskKey}`,
  };
}
