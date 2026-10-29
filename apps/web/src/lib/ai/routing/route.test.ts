import { describe, expect, it } from "vitest";
import { selectDeterministicRoute } from "./route";
import type {
  RouteSignals,
  RoutingCandidate,
  RoutingProfile,
  RoutingTaskKey,
} from "./types";

const candidate = (
  id: string,
  score: number,
  overrides: Partial<RoutingCandidate> = {},
): RoutingCandidate => ({
  deploymentId: id,
  modelId: id,
  chatModel: { provider: "test", model: id },
  providerModelId: id,
  region: "EU",
  dataRetention: "standard",
  inputPriceMicrosPerMillion: 1,
  outputPriceMicrosPerMillion: 1,
  contextTokens: 128000,
  supportsTools: true,
  supportsVision: true,
  active: true,
  profiles: [
    {
      taskKey: "coding",
      score,
      tieBreakPriority: 0,
      bestTaskDescription: "coding",
    },
  ],
  ...overrides,
});

describe("selectDeterministicRoute", () => {
  it("uses task fit only, not price", () => {
    const route = selectDeterministicRoute({
      candidates: [
        candidate("cheaper", 20, { outputPriceMicrosPerMillion: 1 }),
        candidate("best-fit", 90, { outputPriceMicrosPerMillion: 1000 }),
      ],
      signals: {
        taskKey: "coding",
        requiresTools: false,
        requiresVision: false,
        minimumContextTokens: 0,
      },
    });

    expect(route.candidate.deploymentId).toBe("best-fit");
  });

  it("applies hard eligibility before task scoring", () => {
    const route = selectDeterministicRoute({
      candidates: [candidate("disallowed", 100), candidate("allowed", 50)],
      signals: {
        taskKey: "coding",
        requiresTools: false,
        requiresVision: false,
        minimumContextTokens: 0,
      },
      policy: { allowedDeploymentIds: new Set(["allowed"]) },
    });

    expect(route.candidate.deploymentId).toBe("allowed");
  });

  it("fails closed when a deployment has no configured price", () => {
    const route = selectDeterministicRoute({
      candidates: [
        candidate("missing-price", 100, {
          inputPriceMicrosPerMillion: 0,
          outputPriceMicrosPerMillion: 0,
        }),
        candidate("priced", 50),
      ],
      signals: {
        taskKey: "coding",
        requiresTools: false,
        requiresVision: false,
        minimumContextTokens: 0,
      },
    });

    expect(route.candidate.deploymentId).toBe("priced");
  });

  it("uses a stable deployment-id tie break", () => {
    const route = selectDeterministicRoute({
      candidates: [candidate("z", 50), candidate("a", 50)],
      signals: {
        taskKey: "coding",
        requiresTools: false,
        requiresVision: false,
        minimumContextTokens: 0,
      },
    });

    expect(route.candidate.deploymentId).toBe("a");
  });
});

describe("selectDeterministicRoute — thread pinning", () => {
  const signals = (overrides: Partial<RouteSignals> = {}): RouteSignals => ({
    taskKey: "coding",
    requiresTools: false,
    requiresVision: false,
    minimumContextTokens: 0,
    ...overrides,
  });

  it("keeps the thread on its previous model over a better task fit", () => {
    const route = selectDeterministicRoute({
      candidates: [candidate("previous", 20), candidate("best-fit", 90)],
      signals: signals(),
      pinnedChatModel: { provider: "test", model: "previous" },
    });

    expect(route.candidate.deploymentId).toBe("previous");
    expect(route.reasonCode).toBe("thread_pinned:coding");
    expect(route.taskScore).toBe(20);
  });

  it("routes on task fit for the first turn of a thread", () => {
    const route = selectDeterministicRoute({
      candidates: [candidate("previous", 20), candidate("best-fit", 90)],
      signals: signals(),
      pinnedChatModel: undefined,
    });

    expect(route.candidate.deploymentId).toBe("best-fit");
    expect(route.reasonCode).toBe("task_fit:coding");
  });

  it("drops the pin when the pinned model cannot serve this turn", () => {
    const route = selectDeterministicRoute({
      candidates: [
        candidate("previous", 20, { supportsVision: false }),
        candidate("sees", 90),
      ],
      signals: signals({ requiresVision: true }),
      pinnedChatModel: { provider: "test", model: "previous" },
    });

    expect(route.candidate.deploymentId).toBe("sees");
    expect(route.reasonCode).toBe("task_fit:coding");
  });

  it("drops the pin when the organization has since disabled the model", () => {
    const route = selectDeterministicRoute({
      candidates: [candidate("previous", 20), candidate("allowed", 10)],
      signals: signals(),
      policy: { allowedDeploymentIds: new Set(["allowed"]) },
      pinnedChatModel: { provider: "test", model: "previous" },
    });

    expect(route.candidate.deploymentId).toBe("allowed");
  });

  it("ignores a pinned model that has left the catalog", () => {
    const route = selectDeterministicRoute({
      candidates: [candidate("best-fit", 90)],
      signals: signals(),
      pinnedChatModel: { provider: "test", model: "retired" },
    });

    expect(route.candidate.deploymentId).toBe("best-fit");
  });

  it("pins across task keys — a thread does not re-route when the topic turns", () => {
    const candidates = [
      candidate("previous", 20, {
        profiles: [
          {
            taskKey: "coding",
            score: 20,
            tieBreakPriority: 0,
            bestTaskDescription: "coding",
          },
        ],
      }),
      candidate("writer", 0, {
        profiles: [
          {
            taskKey: "writing",
            score: 95,
            tieBreakPriority: 30,
            bestTaskDescription: "writing",
          },
        ],
      }),
    ];

    const route = selectDeterministicRoute({
      candidates,
      signals: signals({ taskKey: "writing" }),
      pinnedChatModel: { provider: "test", model: "previous" },
    });

    expect(route.candidate.deploymentId).toBe("previous");
    // No profile for the new task key: reported as 0 rather than the score of
    // the task the thread was routed on.
    expect(route.taskScore).toBe(0);
  });
});

// Mirrors the seed matrix in migration 0037_model_router_task_fit.sql — keep
// both in sync when re-scoring from new leaderboard data.
describe("july 2026 task matrix", () => {
  const profile = (
    taskKey: RoutingTaskKey,
    score: number,
    tieBreakPriority: number,
  ): RoutingProfile => ({
    taskKey,
    score,
    tieBreakPriority,
    bestTaskDescription: taskKey,
  });

  const matrix = (): RoutingCandidate[] => [
    candidate("base-model", 0, {
      profiles: [profile("tool_calling", 95, 30)],
    }),
    candidate("kimi-k3", 0, {
      profiles: [profile("tool_calling", 85, 20), profile("coding", 82, 0)],
    }),
    candidate("gpt-5.6-terra", 0, {
      profiles: [
        profile("tool_calling", 82, 10),
        profile("general_chat", 88, 20),
        profile("german_business_writing", 88, 20),
        profile("writing", 84, 0),
      ],
    }),
    candidate("gemini-2.5-flash", 0, {
      profiles: [
        profile("web_search", 95, 30),
        profile("general_chat", 92, 30),
        profile("document_extraction", 85, 10),
        profile("vision", 88, 20),
      ],
    }),
    candidate("grok-4.3", 0, { profiles: [profile("web_search", 84, 10)] }),
    candidate("gpt-5.6-luna", 0, {
      profiles: [profile("web_search", 83, 5), profile("general_chat", 82, 10)],
    }),
    candidate("qwen3.7-plus", 0, { profiles: [profile("web_search", 82, 0)] }),
    candidate("claude-opus-4.8", 0, {
      profiles: [
        profile("document_extraction", 95, 30),
        profile("reasoning", 95, 30),
      ],
    }),
    candidate("gemini-3.1-pro-preview", 0, {
      profiles: [
        profile("document_extraction", 88, 20),
        profile("writing", 95, 30),
        profile("german_business_writing", 95, 30),
        profile("vision", 95, 30),
      ],
    }),
    candidate("claude-fable-5", 0, {
      profiles: [
        profile("reasoning", 92, 20),
        profile("writing", 85, 5),
        profile("german_business_writing", 85, 10),
      ],
    }),
    candidate("gpt-5.6-sol", 0, {
      profiles: [
        profile("reasoning", 90, 10),
        profile("coding", 90, 10),
        profile("web_development", 85, 10),
      ],
    }),
    candidate("glm-5.2", 0, {
      supportsVision: false,
      profiles: [profile("web_development", 95, 30), profile("coding", 88, 5)],
    }),
    candidate("claude-sonnet-5", 0, {
      profiles: [
        profile("web_development", 88, 20),
        profile("coding", 95, 30),
        profile("vision", 85, 10),
      ],
    }),
    candidate("grok-4.5", 0, { profiles: [profile("writing", 86, 10)] }),
  ];

  const routeFor = (
    taskKey: RoutingTaskKey,
    options: {
      requiresVision?: boolean;
      allowedDeploymentIds?: Set<string>;
    } = {},
  ) =>
    selectDeterministicRoute({
      candidates: matrix(),
      signals: {
        taskKey,
        requiresTools: true,
        requiresVision: options.requiresVision ?? false,
        minimumContextTokens: 0,
      },
      ...(options.allowedDeploymentIds
        ? { policy: { allowedDeploymentIds: options.allowedDeploymentIds } }
        : {}),
    });

  it("picks the intended winner for every task", () => {
    expect(routeFor("tool_calling").candidate.deploymentId).toBe("base-model");
    expect(routeFor("web_search").candidate.deploymentId).toBe(
      "gemini-2.5-flash",
    );
    expect(routeFor("general_chat").candidate.deploymentId).toBe(
      "gemini-2.5-flash",
    );
    expect(routeFor("document_extraction").candidate.deploymentId).toBe(
      "claude-opus-4.8",
    );
    expect(routeFor("reasoning").candidate.deploymentId).toBe(
      "claude-opus-4.8",
    );
    expect(routeFor("web_development").candidate.deploymentId).toBe("glm-5.2");
    expect(routeFor("coding").candidate.deploymentId).toBe("claude-sonnet-5");
    expect(routeFor("writing").candidate.deploymentId).toBe(
      "gemini-3.1-pro-preview",
    );
    expect(routeFor("german_business_writing").candidate.deploymentId).toBe(
      "gemini-3.1-pro-preview",
    );
    expect(
      routeFor("vision", { requiresVision: true }).candidate.deploymentId,
    ).toBe("gemini-3.1-pro-preview");
  });

  it("falls back to the runner-up when the winner is org-disabled", () => {
    const allowed = new Set(
      matrix()
        .map((c) => c.deploymentId)
        .filter((id) => id !== "glm-5.2"),
    );
    expect(
      routeFor("web_development", { allowedDeploymentIds: allowed }).candidate
        .deploymentId,
    ).toBe("claude-sonnet-5");
  });

  it("never picks a vision-incapable candidate for vision requests", () => {
    const route = routeFor("vision", { requiresVision: true });
    expect(route.candidate.supportsVision).toBe(true);
    expect(route.candidate.deploymentId).not.toBe("glm-5.2");
  });

  it("never picks a tool-incapable candidate when tools are required", () => {
    const candidates = matrix().map((c) =>
      c.deploymentId === "gemini-2.5-flash"
        ? { ...c, supportsTools: false }
        : c,
    );
    const route = selectDeterministicRoute({
      candidates,
      signals: {
        taskKey: "web_search",
        requiresTools: true,
        requiresVision: false,
        minimumContextTokens: 0,
      },
    });
    expect(route.candidate.deploymentId).toBe("grok-4.3");
  });
});
