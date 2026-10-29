import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  org: null as { metadata: string | null } | null,
  sessions: [] as unknown[],
  updates: [] as unknown[],
  selectCalls: 0,
}));

vi.mock("lib/db/pg/db.pg", () => {
  const select = () => {
    const call = h.selectCalls;
    const query: any = {
      from: () => query,
      leftJoin: () => query,
      // First select reads the joined organization, second reads the sessions.
      where: () => {
        h.selectCalls += 1;
        return call === 0
          ? { limit: () => Promise.resolve(h.org ? [h.org] : []) }
          : Promise.resolve(h.sessions);
      },
    };
    return query;
  };
  return {
    pgDb: {
      select,
      update: () => ({
        set: (values: unknown) => ({
          where: () => {
            h.updates.push(values);
            return Promise.resolve();
          },
        }),
      }),
    },
  };
});

vi.mock("logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { adoptTeamWorkspaceInSessions } = await import(
  "./stale-active-workspace"
);

const TEAM_ORG = "f910a0a8-6e2f-454d-8ae8-ebacc062f7e6";
const PERSONAL_ORG = "28513e0e-9bb6-48f9-aebd-217e90233024";
const OTHER_TEAM_ORG = "29672567-b797-4872-b98a-3a2aec8ff0d3";
const USER_ID = "773431c0-f9c9-4f02-834b-06f94a96ab3a";

/** A session row as the left join returns it. */
function session(input: {
  id: string;
  activeOrganizationId: string | null;
  rowId?: string | null;
  metadata?: string | null;
}) {
  return {
    id: input.id,
    activeOrganizationId: input.activeOrganizationId,
    activeOrganizationRowId:
      input.rowId === undefined ? input.activeOrganizationId : input.rowId,
    activeOrganizationMetadata: input.metadata ?? null,
  };
}

beforeEach(() => {
  h.org = { metadata: JSON.stringify({ userId: "someone" }) };
  h.sessions = [];
  h.updates = [];
  h.selectCalls = 0;
});

describe("adoptTeamWorkspaceInSessions", () => {
  it("moves a session still pinned to a personal workspace", async () => {
    // The reported case: the member was added hours after signing in, and the
    // session kept billing to her own workspace for a week.
    h.sessions = [
      session({
        id: "session-1",
        activeOrganizationId: PERSONAL_ORG,
        metadata: JSON.stringify({ personal: true, userId: USER_ID }),
      }),
    ];

    const moved = await adoptTeamWorkspaceInSessions({
      userId: USER_ID,
      organizationId: TEAM_ORG,
    });

    expect(moved).toBe(1);
    expect(h.updates).toEqual([{ activeOrganizationId: TEAM_ORG }]);
  });

  it("leaves a session that is already in another team workspace", async () => {
    // Switching someone out of a workspace they chose would swap the agents,
    // workflows and MCP servers under them, so only the pinned ones move.
    h.sessions = [
      session({
        id: "session-1",
        activeOrganizationId: OTHER_TEAM_ORG,
        metadata: JSON.stringify({ userId: "someone-else" }),
      }),
    ];

    const moved = await adoptTeamWorkspaceInSessions({
      userId: USER_ID,
      organizationId: TEAM_ORG,
    });

    expect(moved).toBe(0);
    expect(h.updates).toEqual([]);
  });

  it("moves sessions with no workspace or a deleted one, and counts only those", async () => {
    h.sessions = [
      session({ id: "none", activeOrganizationId: null }),
      // The workspace was deleted: the left join finds no row.
      session({ id: "gone", activeOrganizationId: "deleted", rowId: null }),
      session({
        id: "chosen",
        activeOrganizationId: OTHER_TEAM_ORG,
        metadata: JSON.stringify({ userId: "someone-else" }),
      }),
    ];

    const moved = await adoptTeamWorkspaceInSessions({
      userId: USER_ID,
      organizationId: TEAM_ORG,
    });

    expect(moved).toBe(2);
    expect(h.updates).toHaveLength(1);
  });

  it("never moves a session into a personal workspace", async () => {
    // Both hooks also fire when someone joins a workspace that is still
    // flagged personal (promotion needs a second member first). Billing there
    // resolves to the user either way, so the move would only mislead.
    h.org = { metadata: JSON.stringify({ personal: true, userId: USER_ID }) };
    h.sessions = [session({ id: "session-1", activeOrganizationId: null })];

    const moved = await adoptTeamWorkspaceInSessions({
      userId: USER_ID,
      organizationId: PERSONAL_ORG,
    });

    expect(moved).toBe(0);
    expect(h.updates).toEqual([]);
  });

  it("writes nothing when the organization row is missing", async () => {
    h.org = null;

    const moved = await adoptTeamWorkspaceInSessions({
      userId: USER_ID,
      organizationId: TEAM_ORG,
    });

    expect(moved).toBe(0);
    expect(h.updates).toEqual([]);
  });
});
