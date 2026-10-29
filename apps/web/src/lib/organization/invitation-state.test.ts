import { describe, expect, it } from "vitest";
import {
  type InvitationRecord,
  maskEmail,
  resolveInvitationState,
} from "./invitation-state";

const NOW = new Date("2026-08-05T12:00:00Z").getTime();

function invitation(
  overrides: Partial<InvitationRecord> = {},
): InvitationRecord {
  return {
    id: "inv-1",
    organizationId: "org-1",
    organizationName: "Acme",
    inviterEmail: "boss@acme.test",
    email: "new.hire@acme.test",
    status: "pending",
    expiresAt: new Date(NOW + 60_000),
    ...overrides,
  };
}

describe("resolveInvitationState", () => {
  it("returns pending for a live invitation addressed to the session user", () => {
    expect(
      resolveInvitationState(invitation(), "new.hire@acme.test", NOW),
    ).toEqual({
      kind: "pending",
      organizationId: "org-1",
      organizationName: "Acme",
      inviterEmail: "boss@acme.test",
    });
  });

  it("matches the invited email case-insensitively", () => {
    expect(
      resolveInvitationState(invitation(), "New.Hire@Acme.test", NOW).kind,
    ).toBe("pending");
  });

  it("reports a wrong account without revealing the full address", () => {
    expect(
      resolveInvitationState(invitation(), "someone.else@acme.test", NOW),
    ).toEqual({ kind: "wrong-account", maskedEmail: "n•••@acme.test" });
  });

  it("hides the state of an invitation belonging to another account", () => {
    // Expired *and* for someone else: the wrong-account card wins, so the
    // link holder learns nothing about an invitation that is not theirs.
    const state = resolveInvitationState(
      invitation({ status: "accepted", expiresAt: new Date(NOW - 1) }),
      "someone.else@acme.test",
      NOW,
    );
    expect(state.kind).toBe("wrong-account");
  });

  it("treats an already-accepted invitation as membership, not an error", () => {
    expect(
      resolveInvitationState(
        invitation({ status: "accepted" }),
        "new.hire@acme.test",
        NOW,
      ),
    ).toEqual({
      kind: "already-member",
      organizationId: "org-1",
      organizationName: "Acme",
    });
  });

  it("distinguishes declined, revoked and expired invitations", () => {
    expect(
      resolveInvitationState(
        invitation({ status: "rejected" }),
        "new.hire@acme.test",
        NOW,
      ).kind,
    ).toBe("declined");
    expect(
      resolveInvitationState(
        invitation({ status: "canceled" }),
        "new.hire@acme.test",
        NOW,
      ).kind,
    ).toBe("revoked");
    expect(
      resolveInvitationState(
        invitation({ expiresAt: new Date(NOW) }),
        "new.hire@acme.test",
        NOW,
      ).kind,
    ).toBe("expired");
  });

  it("returns not-found for a missing invitation", () => {
    expect(resolveInvitationState(null, "new.hire@acme.test", NOW)).toEqual({
      kind: "not-found",
    });
  });
});

describe("maskEmail", () => {
  it("keeps the first character and the domain", () => {
    expect(maskEmail("paul@keinsaas.com")).toBe("p•••@keinsaas.com");
  });

  it("degrades safely without an @", () => {
    expect(maskEmail("not-an-email")).toBe("•••");
    expect(maskEmail("@example.com")).toBe("•••");
  });
});
