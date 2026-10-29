/**
 * Invitation row as the accept-invitation page reads it, joined with the
 * organization name and the inviter's email.
 */
export type InvitationRecord = {
  id: string;
  organizationId: string;
  organizationName: string;
  inviterEmail: string | null;
  email: string;
  status: string;
  expiresAt: Date;
};

/**
 * What the blocking invitation dialog should render. Resolved on the server:
 * Better Auth's `getInvitation` refuses to return an invitation whose email
 * does not match the session, so a client-only lookup cannot tell "wrong
 * account" apart from "expired" or "already used" — every one of them
 * collapses into a single "Invalid invitation" card. Reading the row
 * ourselves keeps those states distinct and actionable.
 */
export type InvitationState =
  | {
      kind: "pending";
      organizationId: string;
      organizationName: string;
      inviterEmail: string | null;
    }
  | { kind: "already-member"; organizationId: string; organizationName: string }
  | { kind: "wrong-account"; maskedEmail: string }
  | { kind: "expired"; organizationName: string }
  | { kind: "declined"; organizationName: string }
  | { kind: "revoked"; organizationName: string }
  | { kind: "not-found" };

/**
 * Hide most of an invited address while leaving it recognisable. The link
 * holder is not necessarily the recipient (invitation emails get forwarded),
 * so the wrong-account card should not spell out someone else's address.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local[0]}•••@${domain}`;
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function resolveInvitationState(
  invitation: InvitationRecord | null,
  sessionEmail: string,
  now: number = Date.now(),
): InvitationState {
  if (!invitation) return { kind: "not-found" };

  // Checked before status/expiry: signing in as the wrong user is the one
  // failure the user can actually fix, and we must not leak the state of
  // someone else's invitation beyond the masked address.
  if (!sameEmail(invitation.email, sessionEmail)) {
    return { kind: "wrong-account", maskedEmail: maskEmail(invitation.email) };
  }

  switch (invitation.status) {
    case "accepted":
      // The invitation was consumed by this same user — a re-opened email
      // link or a double click. Membership already exists, so this is a
      // success state, not an error.
      return {
        kind: "already-member",
        organizationId: invitation.organizationId,
        organizationName: invitation.organizationName,
      };
    case "rejected":
      return {
        kind: "declined",
        organizationName: invitation.organizationName,
      };
    case "canceled":
      return { kind: "revoked", organizationName: invitation.organizationName };
  }

  if (invitation.expiresAt.getTime() <= now) {
    return { kind: "expired", organizationName: invitation.organizationName };
  }

  return {
    kind: "pending",
    organizationId: invitation.organizationId,
    organizationName: invitation.organizationName,
    inviterEmail: invitation.inviterEmail,
  };
}
