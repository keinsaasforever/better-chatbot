import { beforeEach, describe, expect, test, vi } from "vitest";

const PROJECT_ID = "1e0f8f7a-1111-4222-8333-444455556666";
const ACTOR_ID = "3e0f8f7a-1111-4222-8333-444455556666";
const AGENT_ID = "5e0f8f7a-1111-4222-8333-444455556666";
const ORG_ID = "org_123";

const mocks = vi.hoisted(() => ({
  requireProjectAccess: vi.fn(),
  selectResults: [] as unknown[][],
  insertReturning: [] as unknown[],
}));

vi.mock("@/lib/projects/access", () => {
  class ProjectAccessError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    ProjectAccessError,
    requireProjectAccess: (...args: unknown[]) =>
      mocks.requireProjectAccess(...args),
    toProjectErrorResponse: (error: unknown) => {
      if (error instanceof ProjectAccessError) {
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      }
      return Response.json(
        {
          error: { code: "internal_error", message: "Internal Server Error." },
        },
        { status: 500 },
      );
    },
  };
});

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(mocks.selectResults.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: () => Promise.resolve(mocks.insertReturning),
        }),
      }),
    }),
  },
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/projects/${PROJECT_ID}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: PROJECT_ID }) },
  );
}

describe("project agents route POST", () => {
  beforeEach(() => {
    mocks.requireProjectAccess.mockReset();
    mocks.requireProjectAccess.mockResolvedValue({
      actor: { userId: ACTOR_ID, organizationId: ORG_ID },
      project: { id: PROJECT_ID },
      role: "editor",
    });
    mocks.selectResults.length = 0;
    mocks.insertReturning = [];
  });

  test("attaches an accessible agent", async () => {
    mocks.selectResults.push([{ id: AGENT_ID }]);
    mocks.insertReturning = [
      { id: "pa1", projectId: PROJECT_ID, agentId: AGENT_ID },
    ];

    const res = await post({ agentId: AGENT_ID });

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.agent.agentId).toBe(AGENT_ID);
  });

  test("404s when the agent isn't accessible", async () => {
    mocks.selectResults.push([]);

    const res = await post({ agentId: AGENT_ID });

    expect(res.status).toBe(404);
    const payload = await res.json();
    expect(payload.error.code).toBe("agent_not_found");
  });
});
