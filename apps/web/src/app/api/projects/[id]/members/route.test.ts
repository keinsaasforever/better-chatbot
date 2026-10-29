import { beforeEach, describe, expect, test, vi } from "vitest";

const PROJECT_ID = "1e0f8f7a-1111-4222-8333-444455556666";
const OWNER_ID = "2e0f8f7a-1111-4222-8333-444455556666";
const ACTOR_ID = "3e0f8f7a-1111-4222-8333-444455556666";
const TARGET_ID = "4e0f8f7a-1111-4222-8333-444455556666";
const ORG_ID = "org_123";

const mocks = vi.hoisted(() => ({
  requireProjectAccess: vi.fn(),
  isUserMemberOfOrganization: vi.fn(),
  insertReturning: [] as unknown[],
  deleteReturning: [] as unknown[],
}));

// POST delegates to lib/projects/members, which is server-only; the mocks
// below cover every dependency that helper touches, so it runs for real here.
vi.mock("server-only", () => ({}));

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

vi.mock("@/lib/organization/members", () => ({
  isUserMemberOfOrganization: (...args: unknown[]) =>
    mocks.isUserMemberOfOrganization(...args),
}));

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve(mocks.insertReturning),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(mocks.deleteReturning),
      }),
    }),
  },
}));

import { DELETE, POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new Request(`http://localhost/api/projects/${PROJECT_ID}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: PROJECT_ID }) },
  );
}

function del(userId: string) {
  return DELETE(
    new Request(
      `http://localhost/api/projects/${PROJECT_ID}/members?userId=${userId}`,
      { method: "DELETE" },
    ),
    { params: Promise.resolve({ id: PROJECT_ID }) },
  );
}

function defaultAccess() {
  return {
    actor: { userId: ACTOR_ID, organizationId: ORG_ID },
    project: { id: PROJECT_ID, ownerUserId: OWNER_ID },
    role: "editor" as const,
  };
}

describe("project members route", () => {
  beforeEach(() => {
    mocks.requireProjectAccess.mockReset();
    mocks.isUserMemberOfOrganization.mockReset();
    mocks.insertReturning = [];
    mocks.deleteReturning = [];
  });

  test("POST adds an org member as editor", async () => {
    mocks.requireProjectAccess.mockResolvedValue(defaultAccess());
    mocks.isUserMemberOfOrganization.mockResolvedValue(true);
    mocks.insertReturning = [
      { id: "m1", projectId: PROJECT_ID, userId: TARGET_ID, role: "editor" },
    ];

    const res = await post({ userId: TARGET_ID, role: "editor" });

    expect(res.status).toBe(201);
    const payload = await res.json();
    expect(payload.member.userId).toBe(TARGET_ID);
  });

  test("POST 422s when the target isn't an org member", async () => {
    mocks.requireProjectAccess.mockResolvedValue(defaultAccess());
    mocks.isUserMemberOfOrganization.mockResolvedValue(false);

    const res = await post({ userId: TARGET_ID });

    expect(res.status).toBe(422);
    const payload = await res.json();
    expect(payload.error.code).toBe("not_org_member");
  });

  test("DELETE 409s when removing the project owner", async () => {
    mocks.requireProjectAccess.mockResolvedValue(defaultAccess());

    const res = await del(OWNER_ID);

    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload.error.code).toBe("cannot_remove_owner");
  });

  test("DELETE removes a non-owner member", async () => {
    mocks.requireProjectAccess.mockResolvedValue(defaultAccess());
    mocks.deleteReturning = [{ id: "m1" }];

    const res = await del(TARGET_ID);

    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.ok).toBe(true);
  });
});
