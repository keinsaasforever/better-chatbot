import { describe, it, expect, vi, beforeEach } from "vitest";

// T0.12 acceptance check: the non-owner branch of each repository's checkAccess
// must fail closed unless the resource is shared AND belongs to the caller's
// active org. We mock the db layer so the fetched row is fully controlled and
// no live database is needed — the query shape is verified by code-trace.
const h = vi.hoisted(() => ({ row: null as any }));

vi.mock("../db.pg", () => ({
  pgDb: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(h.row ? [h.row] : []),
      }),
    }),
  },
}));

const { pgMcpRepository } = await import("./mcp-repository.pg");
const { pgAgentRepository } = await import("./agent-repository.pg");
const { pgWorkflowRepository } = await import("./workflow-repository.pg");
const { pgSkillRepository } = await import("./skill-repository.pg");

const OWNER = "owner-user";
const OTHER = "other-user";
const ORG_A = "org-a";
const ORG_B = "org-b";

beforeEach(() => {
  h.row = null;
});

describe("mcpRepository.checkAccess org scoping", () => {
  it("grants the owner access regardless of org", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "private" };
    expect(await pgMcpRepository.checkAccess("id", OWNER, false, null)).toBe(
      true,
    );
  });

  it("grants same-org non-owner access to a public server", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgMcpRepository.checkAccess("id", OTHER, false, ORG_A)).toBe(
      true,
    );
  });

  it("denies a second-org non-owner", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgMcpRepository.checkAccess("id", OTHER, false, ORG_B)).toBe(
      false,
    );
  });

  it("denies when the caller has no active org", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgMcpRepository.checkAccess("id", OTHER, false, null)).toBe(
      false,
    );
  });

  it("denies an org-less (null org) public server", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "public" };
    expect(await pgMcpRepository.checkAccess("id", OTHER, false, ORG_A)).toBe(
      false,
    );
  });

  it("denies a non-existent server", async () => {
    h.row = null;
    expect(await pgMcpRepository.checkAccess("id", OTHER, false, ORG_A)).toBe(
      false,
    );
  });
});

describe("agentRepository.checkAccess org scoping", () => {
  it("grants the owner access regardless of org", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "private" };
    expect(await pgAgentRepository.checkAccess("id", OWNER, false, null)).toBe(
      true,
    );
  });

  it("grants same-org non-owner access to a public agent", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgAgentRepository.checkAccess("id", OTHER, false, ORG_A)).toBe(
      true,
    );
  });

  it("denies a second-org non-owner", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgAgentRepository.checkAccess("id", OTHER, false, ORG_B)).toBe(
      false,
    );
  });

  it("denies when the caller has no active org", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgAgentRepository.checkAccess("id", OTHER, false, null)).toBe(
      false,
    );
  });

  it("denies an org-less (null org) public agent", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "public" };
    expect(await pgAgentRepository.checkAccess("id", OTHER, false, ORG_A)).toBe(
      false,
    );
  });
});

describe("skillRepository.checkAccess org scoping", () => {
  it("grants the owner access regardless of org", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "private" };
    expect(await pgSkillRepository.checkAccess("id", OWNER, false, null)).toBe(
      true,
    );
  });

  it("grants same-org non-owner access to a public skill", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgSkillRepository.checkAccess("id", OTHER, false, ORG_A)).toBe(
      true,
    );
  });

  it("denies a second-org non-owner", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgSkillRepository.checkAccess("id", OTHER, false, ORG_B)).toBe(
      false,
    );
  });

  it("denies when the caller has no active org", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgSkillRepository.checkAccess("id", OTHER, false, null)).toBe(
      false,
    );
  });

  it("denies an org-less (null org) public skill", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "public" };
    expect(await pgSkillRepository.checkAccess("id", OTHER, false, ORG_A)).toBe(
      false,
    );
  });

  it("denies destructive access to a same-org non-owner", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(await pgSkillRepository.checkAccess("id", OTHER, true, ORG_A)).toBe(
      false,
    );
  });
});

describe("workflowRepository.checkAccess org scoping", () => {
  it("grants the owner access regardless of org", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "private" };
    expect(
      await pgWorkflowRepository.checkAccess("id", OWNER, true, null),
    ).toBe(true);
  });

  it("grants same-org non-owner read access to a readonly workflow", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "readonly" };
    expect(
      await pgWorkflowRepository.checkAccess("id", OTHER, true, ORG_A),
    ).toBe(true);
  });

  it("denies a second-org non-owner", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(
      await pgWorkflowRepository.checkAccess("id", OTHER, true, ORG_B),
    ).toBe(false);
  });

  it("denies when the caller has no active org", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "public" };
    expect(
      await pgWorkflowRepository.checkAccess("id", OTHER, true, null),
    ).toBe(false);
  });

  it("denies an org-less (null org) shared workflow", async () => {
    h.row = { userId: OWNER, organizationId: null, visibility: "public" };
    expect(
      await pgWorkflowRepository.checkAccess("id", OTHER, true, ORG_A),
    ).toBe(false);
  });

  it("keeps private workflows owner-only even within the same org", async () => {
    h.row = { userId: OWNER, organizationId: ORG_A, visibility: "private" };
    expect(
      await pgWorkflowRepository.checkAccess("id", OTHER, true, ORG_A),
    ).toBe(false);
  });
});
