import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  findMember: vi.fn(),
  findPolicy: vi.fn(),
}));

vi.mock("@/lib/db/pg/db.pg", () => ({
  pgDb: {
    query: {
      MemberTable: { findFirst: (...a: unknown[]) => db.findMember(...a) },
      OrganizationAiPolicyTable: {
        findFirst: (...a: unknown[]) => db.findPolicy(...a),
      },
    },
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
  },
}));

const { resolveBrowserAutomationGate } = await import("./service");

// The policy context is cached per `${organizationId}:${userId}` for 30s, so
// every case needs its own org or it reads the previous case's answer.
let seq = 0;
const freshOrg = () => `org-${++seq}`;

beforeEach(() => {
  db.findMember.mockReset().mockResolvedValue({ id: "member-1" });
  db.findPolicy.mockReset();
});

describe("resolveBrowserAutomationGate", () => {
  it("reports the org's opt-in when the policy is on", async () => {
    db.findPolicy.mockResolvedValue({ browserAutomationEnabled: true });

    await expect(
      resolveBrowserAutomationGate({
        organizationId: freshOrg(),
        userId: "user-1",
      }),
    ).resolves.toEqual({ enabled: true });
  });

  it("reports an explicit opt-out as policy-off", async () => {
    db.findPolicy.mockResolvedValue({ browserAutomationEnabled: false });

    await expect(
      resolveBrowserAutomationGate({
        organizationId: freshOrg(),
        userId: "user-1",
      }),
    ).resolves.toEqual({ enabled: false, reason: "policy-off" });
  });

  it("fails closed with no active organization, without touching the DB", async () => {
    await expect(
      resolveBrowserAutomationGate({ organizationId: null, userId: "user-1" }),
    ).resolves.toEqual({ enabled: false, reason: "no-organization" });
    expect(db.findMember).not.toHaveBeenCalled();
  });

  // The distinction that matters to an admin who already switched the policy
  // on: a failed read must never be reported as "your org said no".
  it("separates a failed policy read from an explicit opt-out", async () => {
    db.findPolicy.mockRejectedValue(new Error('relation "x" does not exist'));

    const gate = await resolveBrowserAutomationGate({
      organizationId: freshOrg(),
      userId: "user-1",
    });

    expect(gate).toEqual({
      enabled: false,
      reason: "policy-unavailable",
      detail: 'relation "x" does not exist',
    });
  });

  it("treats a non-member as unavailable rather than opted out", async () => {
    db.findMember.mockResolvedValue(undefined);

    const gate = await resolveBrowserAutomationGate({
      organizationId: freshOrg(),
      userId: "user-1",
    });

    expect(gate.enabled).toBe(false);
    expect(gate).toMatchObject({ reason: "policy-unavailable" });
  });
});
