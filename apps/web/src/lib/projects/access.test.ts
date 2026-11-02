import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: null as unknown,
  defaultOrg: undefined as string | undefined,
  membership: [{ id: "member-1" }] as { id: string }[],
  updates: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ NextResponse: { json: vi.fn() } }));
vi.mock("auth/server", () => ({ getSession: async () => mocks.session }));
vi.mock("lib/organization/default-org", () => ({
  resolveDefaultActiveOrganizationId: async () => mocks.defaultOrg,
}));
vi.mock("@/lib/db/pg/schema.pg", () => ({
  MemberTable: { id: "id", organizationId: "organizationId", userId: "userId" },
  ProjectMemberTable: {},
  ProjectTable: {},
  SessionTable: { id: "id" },
}));
vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => mocks.membership }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: async () => {
          mocks.updates.push(values);
        },
      }),
    }),
  },
}));

const { requireActiveOrganization } = await import("./access");

beforeEach(() => {
  mocks.defaultOrg = undefined;
  mocks.membership = [{ id: "member-1" }];
  mocks.updates = [];
});

describe("requireActiveOrganization", () => {
  it("falls back to the user's default workspace and records it", async () => {
    mocks.session = {
      user: { id: "user-1" },
      session: { id: "session-1", activeOrganizationId: null },
    };
    mocks.defaultOrg = "org-personal";

    await expect(requireActiveOrganization()).resolves.toEqual({
      userId: "user-1",
      organizationId: "org-personal",
    });
    expect(mocks.updates).toEqual([{ activeOrganizationId: "org-personal" }]);
  });

  it("still refuses a user with no workspace at all", async () => {
    mocks.session = {
      user: { id: "user-1" },
      session: { id: "session-1", activeOrganizationId: null },
    };

    await expect(requireActiveOrganization()).rejects.toMatchObject({
      code: "organization_required",
    });
  });

  it("re-checks membership of the fallback workspace", async () => {
    mocks.session = {
      user: { id: "user-1" },
      session: { id: "session-1", activeOrganizationId: null },
    };
    mocks.defaultOrg = "org-other";
    mocks.membership = [];

    await expect(requireActiveOrganization()).rejects.toMatchObject({
      code: "organization_forbidden",
    });
  });
});
