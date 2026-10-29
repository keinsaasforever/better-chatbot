import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behaviour of the tool executors, through `runTool`. Most of these moved
 * from `lib/voice/execute-app-tool.test.ts` when its executors became registry
 * tools; the cases are the same, under the snake_case names. DB-free: every
 * repository and helper below is mocked.
 */

vi.mock("server-only", () => ({}));

vi.mock("lib/db/repository", () => ({
  agentRepository: {
    selectAgents: vi.fn(),
    selectAgentById: vi.fn(),
    insertAgent: vi.fn(),
    updateAgent: vi.fn(),
    checkAccess: vi.fn(),
  },
  chatRepository: {
    selectThread: vi.fn(),
    insertThread: vi.fn(),
    insertMessage: vi.fn(),
    selectMessagesByThreadId: vi.fn(),
    selectThreadsByUserId: vi.fn(),
  },
  skillRepository: {
    selectSkills: vi.fn(),
    selectSkillById: vi.fn(),
  },
  workflowRepository: {
    selectAll: vi.fn(),
    checkAccess: vi.fn(),
    selectStructureById: vi.fn(),
    save: vi.fn(),
  },
}));

const pgDbMock = vi.hoisted(() => {
  const rows: { current: unknown[] } = { current: [] };
  const chain: Record<string, unknown> = {};
  for (const method of [
    "select",
    "from",
    "where",
    "leftJoin",
    "orderBy",
    "insert",
    "values",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.limit = vi.fn(() => Promise.resolve(rows.current));
  chain.returning = vi.fn(() => Promise.resolve(rows.current));
  return { chain, rows };
});

vi.mock("lib/db/pg/db.pg", () => ({ pgDb: pgDbMock.chain }));

vi.mock("lib/organization/members", () => ({
  fetchOrganizationMembers: vi.fn(),
  isUserMemberOfOrganization: vi.fn(),
}));

vi.mock("lib/projects/members", () => {
  class ProjectMemberError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ProjectMemberError";
    }
  }
  return { ProjectMemberError, addProjectMember: vi.fn() };
});

vi.mock("lib/projects/create-project", () => ({
  createProject: vi.fn(),
}));

vi.mock("lib/voice/project-resolver", () => ({
  listAccessibleProjects: vi.fn(),
  // Mirrors the real matcher closely enough for dispatch tests: exact
  // case-insensitive match first, then containment.
  matchProjectByName: (
    projects: { id: string; name: string }[],
    name?: string | null,
  ) => {
    if (!name) return null;
    const needle = name.trim().toLowerCase();
    return (
      projects.find((p) => p.name.toLowerCase() === needle) ??
      projects.find((p) => p.name.toLowerCase().includes(needle)) ??
      null
    );
  },
}));

vi.mock("lib/project-brain/generated-insights", () => ({
  getLatestProjectStatusSnapshot: vi.fn(),
  getRecentProjectEvents: vi.fn(),
}));

vi.mock("lib/projects/access", () => {
  class ProjectAccessError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ProjectAccessError";
    }
  }
  return { ProjectAccessError, requireProjectAccess: vi.fn() };
});

vi.mock("lib/auth/permissions", () => ({
  roleHasPermission: (role: string) => role === "admin" || role === "editor",
}));

vi.mock("lib/gate", () => {
  class CreditsExhaustedError extends Error {}
  return {
    CreditsExhaustedError,
    assertCreditsAvailable: vi.fn(),
    trackUsage: vi.fn(),
  };
});

vi.mock("lib/billing/billing-customer", () => ({
  resolveBillingCustomerById: vi
    .fn()
    .mockResolvedValue({ customerId: "org-1", entityId: "user-1" }),
}));

vi.mock("lib/ai/models", () => ({
  getModelInstance: vi.fn().mockResolvedValue({}),
}));

vi.mock("lib/ai/telemetry", () => ({
  aiTelemetry: vi.fn().mockReturnValue(undefined),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  stepCountIs: vi.fn().mockReturnValue(() => false),
}));

vi.mock("next/server", () => ({
  after: vi.fn((callback: () => unknown) => {
    void callback();
  }),
}));

vi.mock("lib/voice/run-transcript-command", () => ({
  VOICE_COMMAND_MODEL: { provider: "test", model: "test-model" },
}));

vi.mock("lib/voice/voice-session", () => ({
  buildVoiceAgentContext: vi.fn(),
}));

vi.mock("lib/ai/workflow/executor/workflow-executor", () => ({
  createWorkflowExecutor: vi.fn(),
}));

vi.mock("lib/voice/workflow-draft", () => ({
  createWorkflowDraftFromTranscript: vi.fn(),
}));

vi.mock("lib/scheduled-tasks/list-tasks", () => ({
  listScheduledTasksForUser: vi.fn(),
}));

vi.mock("lib/scheduled-tasks/trigger", () => ({
  triggerScheduledTaskForUser: vi.fn(),
}));

vi.mock("lib/notifications/create-notifications", () => ({
  createNotifications: vi.fn(),
}));

// The real feeds read encrypted connections and call providers; the tools
// only fold their result, so the feed loader is stubbed.
vi.mock("lib/cockpit/feeds", () => ({ getCockpitData: vi.fn() }));

const { agentRepository, chatRepository, skillRepository } = await import(
  "lib/db/repository"
);
const { fetchOrganizationMembers } = await import("lib/organization/members");
const { addProjectMember: addProjectMemberShared } = await import(
  "lib/projects/members"
);
const { listAccessibleProjects } = await import("lib/voice/project-resolver");
const { getLatestProjectStatusSnapshot, getRecentProjectEvents } = await import(
  "lib/project-brain/generated-insights"
);
const { requireProjectAccess } = await import("lib/projects/access");
const { generateText } = await import("ai");
const { buildVoiceAgentContext } = await import("lib/voice/voice-session");
const { assertCreditsAvailable, CreditsExhaustedError, trackUsage } =
  await import("lib/gate");
const { createNotifications } = await import(
  "lib/notifications/create-notifications"
);
const { triggerScheduledTaskForUser } = await import(
  "lib/scheduled-tasks/trigger"
);
const { workflowRepository } = await import("lib/db/repository");
const { createWorkflowExecutor } = await import(
  "lib/ai/workflow/executor/workflow-executor"
);
const { getCockpitData } = await import("lib/cockpit/feeds");
const { runTool } = await import("../registry");

const actor = {
  userId: "user-1",
  organizationId: "org-1",
  source: "voice" as const,
};

describe("list_agents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shapes output to id/name/trimmed description", async () => {
    vi.mocked(agentRepository.selectAgents).mockResolvedValue([
      { id: "agent-1", name: "Sales Agent", description: "x".repeat(200) },
      { id: "agent-2", name: "Research", description: undefined },
    ] as never);

    const result = await runTool(actor, "list_agents", {});

    expect(agentRepository.selectAgents).toHaveBeenCalledWith(
      "user-1",
      ["all"],
      50,
      "org-1",
    );
    expect(result.ok).toBe(true);
    const output = (result as { output: { agents: unknown[] } }).output as {
      agents: { id: string; name: string; description: string | null }[];
    };
    expect(output.agents).toHaveLength(2);
    expect(output.agents[0].description!.length).toBeLessThanOrEqual(120);
    expect(output.agents[1].description).toBeNull();
  });

  it("answers a repository failure generically, without its message", async () => {
    vi.mocked(agentRepository.selectAgents).mockRejectedValue(
      new Error("db down: password=hunter2"),
    );
    const result = await runTool(actor, "list_agents", {});
    expect(result).toEqual({
      ok: false,
      error: {
        code: "tool_execution_failed",
        message: expect.not.stringContaining("hunter2"),
      },
    });
  });
});

describe("list_projects", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists accessible projects for the actor", async () => {
    vi.mocked(listAccessibleProjects).mockResolvedValue([
      { id: "p1", name: "Website", description: null },
    ]);

    const result = await runTool(actor, "list_projects", {});

    expect(listAccessibleProjects).toHaveBeenCalledWith("user-1", "org-1");
    expect(result).toEqual({
      ok: true,
      output: { projects: [{ id: "p1", name: "Website", description: null }] },
    });
  });
});

describe("get_project_status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAccessibleProjects).mockResolvedValue([
      { id: "p1", name: "Website", description: null },
      { id: "p2", name: "App", description: null },
    ]);
    vi.mocked(requireProjectAccess).mockResolvedValue({} as never);
  });

  it("rejects invalid arguments without throwing", async () => {
    const result = await runTool(actor, "get_project_status", {
      projectId: "not-a-uuid",
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("invalid_arguments");
  });

  it("fails closed without an active organization", async () => {
    const result = await runTool(
      { ...actor, organizationId: null },
      "get_project_status",
      { projectName: "Website" },
    );
    expect(!result.ok && result.error.code).toBe("organization_required");
    expect(listAccessibleProjects).not.toHaveBeenCalled();
  });

  it("returns the project roster when nothing matches", async () => {
    const result = await runTool(actor, "get_project_status", {
      projectName: "Unbekannt",
    });
    expect(result).toEqual({
      ok: true,
      output: {
        found: false,
        note: "Kein passendes Projekt gefunden.",
        projects: ["Website", "App"],
      },
    });
  });

  it("shapes snapshot, todos, and recent events", async () => {
    vi.mocked(getLatestProjectStatusSnapshot).mockResolvedValue({
      health: "yellow",
      summary: "fallback summary",
      generatedAt: new Date("2026-08-10T05:00:00Z"),
      statusRenderData: {
        health: "yellow",
        progressPct: 60,
        summary: "On track-ish",
        blockers: ["waiting on API keys"],
      },
      todosRenderData: {
        items: Array.from({ length: 12 }, (_, i) => ({
          title: `todo ${i}`,
          status: "open",
          priority: "medium",
        })),
      },
    } as never);
    vi.mocked(getRecentProjectEvents).mockResolvedValue([
      { eventDate: new Date("2026-08-11T00:00:00Z"), summary: "Kickoff done" },
    ] as never);

    const result = await runTool(actor, "get_project_status", {
      projectName: "website",
    });

    expect(result.ok).toBe(true);
    const output = (result as { output: Record<string, unknown> }).output;
    expect(output.project).toEqual({ id: "p1", name: "Website" });
    expect(output.status).toEqual(
      expect.objectContaining({ health: "yellow", progressPct: 60 }),
    );
    expect((output.todos as unknown[]).length).toBe(10);
    expect(output.recentEvents).toEqual([
      { date: "2026-08-11", title: "Kickoff done" },
    ]);
  });

  it("resolves by projectId and reports a missing snapshot as a note", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    vi.mocked(listAccessibleProjects).mockResolvedValue([
      { id: projectId, name: "Website", description: null },
    ]);
    vi.mocked(getLatestProjectStatusSnapshot).mockResolvedValue(null as never);
    vi.mocked(getRecentProjectEvents).mockResolvedValue([]);

    const result = await runTool(actor, "get_project_status", { projectId });

    const output = (result as { output: Record<string, unknown> }).output;
    expect(output.found).toBeUndefined();
    expect(output.project).toEqual({ id: projectId, name: "Website" });
    expect(output.status).toBeNull();
    expect(output.note).toBe("Noch keine Statusdaten vorhanden.");
  });

  it("returns the roster when a projectId is not accessible", async () => {
    const result = await runTool(actor, "get_project_status", {
      projectId: "99999999-9999-4999-8999-999999999999",
    });
    expect((result as { output: Record<string, unknown> }).output.found).toBe(
      false,
    );
  });
});

describe("send_chat_message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAccessibleProjects).mockResolvedValue([]);
    vi.mocked(chatRepository.insertThread).mockResolvedValue({} as never);
    vi.mocked(chatRepository.insertMessage).mockResolvedValue({} as never);
    vi.mocked(generateText).mockResolvedValue({ text: "Alles klar." } as never);
  });

  const roles = () =>
    vi
      .mocked(chatRepository.insertMessage)
      .mock.calls.map(([message]) => (message as { role: string }).role);

  it("rejects a thread the actor does not own", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue({
      id: "t1",
      userId: "someone-else",
    } as never);

    const result = await runTool(actor, "send_chat_message", {
      message: "Hallo",
      threadId: "22222222-2222-4222-8222-222222222222",
    });

    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(chatRepository.insertMessage).not.toHaveBeenCalled();
  });

  it("creates a thread and persists user and assistant turns", async () => {
    const result = await runTool(actor, "send_chat_message", {
      message: "Bitte notieren: Meeting Freitag.",
    });

    const output = (result as { output: Record<string, unknown> }).output;
    expect(output.createdThread).toBe(true);
    expect(output.reply).toBe("Alles klar.");
    expect(chatRepository.insertThread).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        title: "Bitte notieren: Meeting Freitag.",
      }),
    );
    expect(roles()).toEqual(["user", "assistant"]);
    const [userTurn] = vi.mocked(chatRepository.insertMessage).mock.calls[0];
    expect((userTurn as { metadata: { source: string } }).metadata.source).toBe(
      "voice_realtime",
    );
  });

  it("marks turns written over MCP as such", async () => {
    await runTool({ ...actor, source: "mcp" }, "send_chat_message", {
      message: "Hallo",
    });
    const [userTurn] = vi.mocked(chatRepository.insertMessage).mock.calls[0];
    expect((userTurn as { metadata: { source: string } }).metadata.source).toBe(
      "navigator_mcp",
    );
  });

  it("delegates to an agent in the background and returns immediately", async () => {
    vi.mocked(buildVoiceAgentContext).mockResolvedValue({
      agent: { id: "agent-1", name: "Recherche" },
      enabledMentions: [],
      mcpTools: {},
      systemPrompt: "agent prompt",
    } as never);
    vi.mocked(generateText).mockResolvedValue({
      text: "Recherche fertig.",
    } as never);

    const result = await runTool(actor, "send_chat_message", {
      message: "Recherchiere bitte X",
      agentId: "33333333-3333-4333-8333-333333333333",
    });

    expect((result as { output: unknown }).output).toEqual(
      expect.objectContaining({
        delegatedTo: "Recherche",
        status: "running",
        createdThread: true,
      }),
    );
    // after() mock runs the background task inline: agent turn was persisted.
    await vi.waitFor(() => expect(roles()).toEqual(["user", "assistant"]));
  });

  it("returns not_found for an unknown agent but keeps the thread intact", async () => {
    vi.mocked(buildVoiceAgentContext).mockResolvedValue({
      agent: undefined,
      enabledMentions: [],
      mcpTools: {},
      systemPrompt: "",
    } as never);

    const result = await runTool(actor, "send_chat_message", {
      message: "Hallo",
      agentId: "33333333-3333-4333-8333-333333333333",
    });

    expect(!result.ok && result.error.code).toBe("not_found");
    expect(roles()).toEqual(["user", "assistant"]);
  });

  it("refuses before writing anything when the workspace has no credits", async () => {
    vi.mocked(assertCreditsAvailable).mockRejectedValueOnce(
      new CreditsExhaustedError(),
    );

    const result = await runTool(actor, "send_chat_message", {
      message: "Hallo",
    });

    expect(!result.ok && result.error.code).toBe("credits_exhausted");
    expect(chatRepository.insertThread).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("bills the reply it generated", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: "Alles klar.",
      usage: { inputTokens: 10, outputTokens: 5 },
      response: { id: "resp-1" },
    } as never);

    await runTool(actor, "send_chat_message", { message: "Hallo" });

    expect(trackUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "tokens",
        customerId: "org-1",
        promptTokens: 10,
        completionTokens: 5,
        idempotencyKey: "navigator-tool-chat_reply-resp-1",
      }),
    );
  });
});

describe("get_chat_reply", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses a thread the actor does not own", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue({
      id: "t1",
      userId: "someone-else",
    } as never);
    const result = await runTool(actor, "get_chat_reply", {
      threadId: "22222222-2222-4222-8222-222222222222",
    });
    expect(!result.ok && result.error.code).toBe("not_found");
    expect(chatRepository.selectMessagesByThreadId).not.toHaveBeenCalled();
  });

  it("reads only the bounded window and reports a pending answer", async () => {
    vi.mocked(chatRepository.selectThread).mockResolvedValue({
      id: "t1",
      userId: "user-1",
      title: "Leads",
    } as never);
    vi.mocked(chatRepository.selectMessagesByThreadId).mockResolvedValue([
      {
        role: "assistant",
        parts: [{ type: "text", text: "Earlier answer" }],
        createdAt: new Date("2026-10-01T10:00:00Z"),
      },
      { role: "user", parts: [{ type: "text", text: "And now?" }] },
    ] as never);

    const result = await runTool(actor, "get_chat_reply", {
      threadId: "22222222-2222-4222-8222-222222222222",
    });

    expect(chatRepository.selectMessagesByThreadId).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      { limit: 50 },
    );
    expect((result as { output: unknown }).output).toEqual(
      expect.objectContaining({
        pending: true,
        reply: {
          text: "Earlier answer",
          createdAt: "2026-10-01T10:00:00.000Z",
        },
      }),
    );
  });
});

describe("add_project_member", () => {
  const orgMembers = [
    {
      id: "m1",
      role: "member",
      userId: "anna-1",
      user: {
        name: "Anna Schmidt",
        email: "anna.schmidt@example.com",
        image: null,
      },
    },
    {
      id: "m2",
      role: "member",
      userId: "anna-2",
      user: {
        name: "Anna Weber",
        email: "anna.weber@example.com",
        image: null,
      },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAccessibleProjects).mockResolvedValue([
      { id: "p1", name: "Website", description: null },
    ]);
    vi.mocked(fetchOrganizationMembers).mockResolvedValue(orgMembers as never);
    vi.mocked(addProjectMemberShared).mockResolvedValue({
      userId: "anna-1",
      role: "editor",
    } as never);
  });

  it("refuses ambiguous names with candidate list", async () => {
    const result = await runTool(actor, "add_project_member", {
      projectName: "Website",
      memberNameOrEmail: "Anna",
    });
    expect(!result.ok && result.error.code).toBe("ambiguous_member");
    expect(!result.ok && result.error.message).toContain("Anna Schmidt");
    expect(!result.ok && result.error.message).toContain("Anna Weber");
    expect(addProjectMemberShared).not.toHaveBeenCalled();
  });

  it("rejects people who are not org members", async () => {
    const result = await runTool(actor, "add_project_member", {
      projectName: "Website",
      memberNameOrEmail: "Fremde Person",
    });
    expect(!result.ok && result.error.code).toBe("not_org_member");
  });

  it("adds a uniquely matched member via the shared helper", async () => {
    const result = await runTool(actor, "add_project_member", {
      projectName: "Website",
      memberNameOrEmail: "anna.schmidt@example.com",
      role: "viewer",
    });

    expect(addProjectMemberShared).toHaveBeenCalledWith({
      projectId: "p1",
      userId: "anna-1",
      role: "viewer",
      actor: { userId: "user-1", organizationId: "org-1" },
    });
    expect(result).toEqual({
      ok: true,
      output: {
        added: true,
        member: { name: "Anna Schmidt", role: "editor" },
        project: "Website",
      },
    });
  });
});

describe("load_skill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(skillRepository.selectSkills).mockResolvedValue([
      { id: "s1", name: "Angebot schreiben", slug: "quote" },
      { id: "s2", name: "Invoice", slug: "invoice" },
    ] as never);
  });

  it("returns available skill names when nothing matches", async () => {
    const result = await runTool(actor, "load_skill", {
      skillName: "Gibtsnicht",
    });
    expect(result).toEqual({
      ok: true,
      output: {
        found: false,
        note: "Kein passender Skill gefunden.",
        skills: ["Angebot schreiben", "Invoice"],
      },
    });
  });

  it("loads and caps the matched skill content", async () => {
    vi.mocked(skillRepository.selectSkillById).mockResolvedValue({
      id: "s1",
      name: "Angebot schreiben",
      description: "Erstellt Angebote",
      content: "x".repeat(10000),
    } as never);

    const result = await runTool(actor, "load_skill", {
      skillName: "angebot schreiben",
    });

    expect(skillRepository.selectSkillById).toHaveBeenCalledWith(
      "s1",
      "user-1",
      "org-1",
    );
    const output = (result as { output: { content: string } }).output;
    expect(output.content.length).toBe(4000);
  });
});

describe("create_agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pgDbMock.rows.current = [];
  });

  it("refuses a plain user role", async () => {
    pgDbMock.rows.current = [{ role: "user" }];
    const result = await runTool(actor, "create_agent", { name: "Sales" });
    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(agentRepository.insertAgent).not.toHaveBeenCalled();
  });

  it("creates the agent in the actor's organization for an editor", async () => {
    pgDbMock.rows.current = [{ role: "editor" }];
    vi.mocked(agentRepository.insertAgent).mockResolvedValue({
      id: "agent-9",
      name: "Sales",
      visibility: "private",
    } as never);

    const result = await runTool(actor, "create_agent", {
      name: "Sales",
      role: "sales",
      instructions: "Qualify leads.",
    });

    expect(agentRepository.insertAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sales",
        userId: "user-1",
        organizationId: "org-1",
        visibility: "private",
        instructions: { role: "sales", systemPrompt: "Qualify leads." },
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("run_scheduled_task", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only triggers the actor's own task", async () => {
    vi.mocked(triggerScheduledTaskForUser).mockResolvedValue(null);
    const result = await runTool(actor, "run_scheduled_task", {
      taskId: "44444444-4444-4444-8444-444444444444",
    });
    expect(triggerScheduledTaskForUser).toHaveBeenCalledWith(
      "user-1",
      "44444444-4444-4444-8444-444444444444",
    );
    expect(!result.ok && result.error.code).toBe("not_found");
  });
});

describe("cockpit", () => {
  const inop = (reason: string) => ({ status: "inop" as const, reason });
  const allInop = {
    marketing: inop("notConnected"),
    products: inop("notConnected"),
    stripe: inop("notConnected"),
    revolut: inop("notConnected"),
    superlog: inop("notConnected"),
    seo: inop("notConnected"),
    connections: [],
    generatedAt: "2026-10-07T10:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCockpitData).mockResolvedValue(allInop as never);
  });

  it("reports every feed as INOP with its reason until feeds are connected", async () => {
    const result = await runTool(actor, "cockpit_summary", {});
    const output = (result as { output: Record<string, unknown> }).output;
    for (const key of ["finance", "marketing", "productHealth", "seo"]) {
      expect(output[key]).toEqual({ status: "inop", reason: "Not connected" });
    }
    expect(output.attention).toEqual([]);
    expect(output.note).toMatch(/do not estimate/);
  });

  it("reads the feeds for the actor's own scope", async () => {
    await runTool(actor, "cockpit_finance", {});
    expect(getCockpitData).toHaveBeenCalledWith({
      userId: "user-1",
      organizationId: "org-1",
    });
  });

  it("folds live Stripe data into the finance feed and flags failed payments", async () => {
    vi.mocked(getCockpitData).mockResolvedValue({
      ...allInop,
      stripe: {
        status: "live",
        updatedAt: "2026-10-07T10:00:00.000Z",
        data: {
          currency: "eur",
          balanceAvailable: 123_456,
          balancePending: 0,
          mrr: 1_200_000,
          activeSubscriptions: 40,
          payments30d: { count: 52, volume: 1_300_000 },
          failed7d: Array.from({ length: 12 }, (_, i) => ({
            id: `ch_${i}`,
            amount: 4_900,
            currency: "eur",
            created: "2026-10-06T10:00:00.000Z",
            description: null,
          })),
          nextPayout: null,
        },
      },
      revolut: inop("reauthorize"),
    } as never);

    const finance = (
      (await runTool(actor, "cockpit_finance", {})) as {
        output: { finance: Record<string, any> };
      }
    ).output.finance;
    expect(finance.status).toBe("live");
    expect(finance.data).toMatchObject({
      currency: "EUR",
      mrr: 12_000,
      cash: 1_235,
      activeSubscriptions: 40,
      sources: {
        stripe: "live",
        revolut: "Authorization expired: reauthorize in CONNECT",
      },
    });
    expect(finance.data.failedPayments7d.count).toBe(12);
    expect(finance.data.failedPayments7d.latest).toHaveLength(5);

    const summary = (
      (await runTool(actor, "cockpit_summary", {})) as {
        output: Record<string, any>;
      }
    ).output;
    expect(summary.attention).toEqual([
      "12 failed payment(s) in the last 7 days",
    ]);
    // The summary keeps the headline count only, not the list.
    expect(summary.finance.data.failedPayments7d).toEqual({ count: 12 });
    expect(summary.note).toBeUndefined();
  });

  it("posts an update for the actor only, with severity on the type", async () => {
    vi.mocked(createNotifications).mockResolvedValue({
      inserted: [{ id: "n1", userId: "user-1" }],
    });

    const result = await runTool(actor, "cockpit_push_update", {
      title: "Deploy failed",
      severity: "alert",
      url: "/projects/p1",
    });

    expect(createNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ["user-1"],
        type: "cockpit_update.alert",
        title: "Deploy failed",
        url: "/projects/p1",
        dedupeKey: expect.stringMatching(/^cockpit:[0-9a-f]{24}:\d+$/),
      }),
    );
    expect((result as { output: unknown }).output).toEqual({
      posted: true,
      id: "n1",
      severity: "alert",
    });
  });

  it("refuses a link that is not an in-app path or https", async () => {
    for (const url of ["javascript:alert(1)", "//evil.example", "http://x.y"]) {
      const result = await runTool(actor, "cockpit_push_update", {
        title: "Hi",
        url,
      });
      expect(!result.ok && result.error.code).toBe("invalid_arguments");
    }
    expect(createNotifications).not.toHaveBeenCalled();
  });
});

describe("execute_workflow", () => {
  const workflowRow = {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Lead digest",
    userId: "user-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workflowRepository.selectAll).mockResolvedValue([
      workflowRow,
    ] as never);
    vi.mocked(workflowRepository.checkAccess).mockResolvedValue(true);
    vi.mocked(workflowRepository.selectStructureById).mockResolvedValue({
      ...workflowRow,
      nodes: [
        { id: "in", name: "Input", kind: "input" },
        { id: "out", name: "Output", kind: "output" },
      ],
      edges: [],
    } as never);
  });

  it("runs a workflow found by name and returns its output node's result", async () => {
    let listener: (event: unknown) => void = () => {};
    vi.mocked(createWorkflowExecutor).mockReturnValue({
      subscribe: (fn: (event: unknown) => void) => {
        listener = fn;
      },
      run: async () => {
        listener({
          eventType: "NODE_END",
          isOk: true,
          node: {
            name: "out",
            output: { getOutput: () => ({ leads: 3 }) },
          },
        });
        return { isOk: true };
      },
      exit: vi.fn(),
    } as never);

    const result = await runTool(actor, "execute_workflow", {
      workflow: "lead digest",
      input: { week: 41 },
    });

    expect(workflowRepository.checkAccess).toHaveBeenCalledWith(
      workflowRow.id,
      "user-1",
      true,
      "org-1",
    );
    expect((result as { output: unknown }).output).toEqual(
      expect.objectContaining({ status: "success", output: { leads: 3 } }),
    );
  });

  it("refuses a workflow the actor cannot run, before building anything", async () => {
    vi.mocked(workflowRepository.checkAccess).mockResolvedValue(false);
    const result = await runTool(actor, "execute_workflow", {
      workflow: workflowRow.id,
    });
    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(createWorkflowExecutor).not.toHaveBeenCalled();
  });
});
