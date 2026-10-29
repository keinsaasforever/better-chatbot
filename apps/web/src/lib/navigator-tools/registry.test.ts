import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The registry contract: names, flags, validation and error shape, plus one
 * end-to-end org-scoping check through the real project query with a mocked
 * `pgDb`. DB-free.
 */

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  where: [] as unknown[],
  leftJoins: 0,
}));

vi.mock("lib/db/pg/db.pg", () => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.leftJoin = vi.fn(() => {
    db.leftJoins += 1;
    return chain;
  });
  chain.where = vi.fn((condition: unknown) => {
    db.where.push(condition);
    return Promise.resolve([]);
  });
  return { pgDb: chain };
});

// Everything below is only here so the registry's tool modules can load.
vi.mock("lib/db/repository", () => ({
  agentRepository: {},
  chatRepository: {},
  skillRepository: {},
  workflowRepository: {},
}));
vi.mock("lib/organization/members", () => ({}));
vi.mock("lib/projects/members", () => ({
  ProjectMemberError: class extends Error {},
}));
vi.mock("lib/projects/access", () => ({
  ProjectAccessError: class extends Error {},
}));
vi.mock("lib/projects/create-project", () => ({}));
vi.mock("lib/project-brain/generated-insights", () => ({}));
vi.mock("lib/auth/permissions", () => ({ roleHasPermission: () => false }));
vi.mock("lib/gate", () => ({ CreditsExhaustedError: class extends Error {} }));
vi.mock("lib/billing/billing-customer", () => ({}));
vi.mock("lib/ai/models", () => ({}));
vi.mock("lib/ai/telemetry", () => ({}));
vi.mock("ai", () => ({}));
vi.mock("next/server", () => ({}));
vi.mock("lib/voice/run-transcript-command", () => ({
  VOICE_COMMAND_MODEL: { provider: "test", model: "test-model" },
}));
vi.mock("lib/voice/voice-session", () => ({}));
vi.mock("lib/ai/workflow/executor/workflow-executor", () => ({}));
vi.mock("lib/voice/workflow-draft", () => ({}));
vi.mock("lib/scheduled-tasks/list-tasks", () => ({}));
vi.mock("lib/scheduled-tasks/trigger", () => ({}));
vi.mock("lib/notifications/create-notifications", () => ({}));

const { NAVIGATOR_TOOLS, getTool, listTools, runTool } = await import(
  "./registry"
);
const { NAVIGATOR_TOOL_SPECS } = await import("./definitions");

const dialect = new PgDialect();
const render = (condition: unknown) => dialect.sqlToQuery(condition as SQL);

describe("navigator tool registry", () => {
  beforeEach(() => {
    db.where = [];
    db.leftJoins = 0;
  });

  it("pairs every catalog entry with a runner, in catalog order", () => {
    expect(NAVIGATOR_TOOLS.map((tool) => tool.name)).toEqual(
      NAVIGATOR_TOOL_SPECS.map((definition) => definition.name),
    );
    for (const tool of NAVIGATOR_TOOLS) {
      expect(typeof tool.run).toBe("function");
    }
  });

  it("uses names that are valid for both Realtime and MCP", () => {
    const names = NAVIGATOR_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9_]{1,64}$/);
  });

  /**
   * Realtime re-sends every tool schema on every turn, so the voice surface
   * is held small: at most 30 tools, at most 200 characters each.
   */
  it("keeps the voice surface within the per-turn budget", () => {
    const voiceTools = listTools({ voice: true });
    expect(voiceTools.length).toBeLessThanOrEqual(30);
    for (const tool of NAVIGATOR_TOOLS) {
      expect(tool.description.length).toBeLessThanOrEqual(200);
    }
    expect(
      listTools({ voice: false })
        .map((tool) => tool.name)
        .sort(),
    ).toEqual(["cockpit_list_updates", "create_workflow", "update_agent"]);
  });

  it("flags exactly the tools that change something as not read-only", () => {
    const mutating = NAVIGATOR_TOOLS.filter((tool) => !tool.readOnly)
      .map((tool) => tool.name)
      .sort();
    expect(mutating).toEqual([
      "add_project_member",
      "cockpit_push_update",
      "create_agent",
      "create_chat",
      "create_project",
      "create_scheduled_task",
      "create_workflow",
      "execute_workflow",
      "generate_workflow",
      // The agent it asks has its own tools and may act.
      "run_agent",
      "run_scheduled_task",
      "send_chat_message",
      "update_agent",
    ]);
  });

  it("ships no tool that deletes anything", () => {
    for (const tool of NAVIGATOR_TOOLS) {
      expect(tool.name).not.toMatch(/delete|remove|destroy/);
    }
  });

  it("answers an unknown tool without throwing", async () => {
    expect(getTool("drop_database")).toBeUndefined();
    await expect(
      runTool(
        { userId: "u1", organizationId: "o1", source: "mcp" },
        "drop_database",
        {},
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "unknown_tool", message: 'Unknown tool "drop_database"' },
    });
  });

  it("rejects arguments that fail the schema before anything runs", async () => {
    const result = await runTool(
      { userId: "u1", organizationId: "o1", source: "mcp" },
      "get_chat_reply",
      { threadId: "not-a-uuid" },
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("invalid_arguments");
    expect(!result.ok && result.error.message).toMatch(/^threadId: /);
  });

  /**
   * The repository convention, end to end: with an active organization the
   * project list is that org's projects the user owns or is a member of;
   * without one it fails closed to the user's own projects, with no
   * organization branch at all.
   */
  describe("org scoping on list_projects", () => {
    it("scopes to the actor's organization when one is active", async () => {
      const result = await runTool(
        { userId: "user-1", organizationId: "org-1", source: "mcp" },
        "list_projects",
        {},
      );
      expect(result).toEqual({ ok: true, output: { projects: [] } });
      expect(db.leftJoins).toBe(1);
      const { sql, params } = render(db.where[0]);
      expect(sql).toContain('"project"."organization_id" = $1');
      expect(params).toEqual(["org-1", "user-1"]);
    });

    it("fails closed to owner-only without an active organization", async () => {
      await runTool(
        { userId: "user-1", organizationId: null, source: "mcp" },
        "list_projects",
        {},
      );
      expect(db.leftJoins).toBe(0);
      const { sql, params } = render(db.where[0]);
      expect(sql).toBe('"project"."owner_user_id" = $1');
      expect(params).toEqual(["user-1"]);
    });
  });
});
