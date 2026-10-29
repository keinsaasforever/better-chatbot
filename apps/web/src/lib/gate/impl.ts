import "server-only";
import type {
  BillingContext,
  CreatedUser,
  Feature,
  NotificationEmail,
  OrganizationInvitation,
  PasswordResetEmail,
} from "./types";

/**
 * Community implementation of the billing/entitlement seam.
 *
 * This edition has no billing provider: nothing is metered, every feature is
 * available, and there is no customer to bill. Each function keeps the
 * signature its cloud counterpart has so callers never branch on the edition.
 */

/** Session-derived identity. `customerId` is null: nothing is billed here. */
export async function getBillingContext(): Promise<BillingContext | null> {
  const { getSession } = await import("@/lib/auth/auth-instance");
  const session = await getSession();
  if (!session?.user) return null;

  return {
    customerId: null,
    userId: session.user.id,
    customerData: {
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    },
  };
}

export async function requireBillingContext(): Promise<BillingContext> {
  const context = await getBillingContext();
  if (!context) throw new Error("Unauthorized - No valid session found");
  return context;
}

/** No credit pool to exhaust. */
export async function assertCreditsAvailable(_input: {
  customerId: string | null;
  entityId?: string;
}): Promise<void> {}

/** Every feature is included; availability is decided by configuration. */
export async function checkFeature(
  _feature: Feature,
  _input: { customerId?: string | null; entityId?: string } = {},
): Promise<boolean> {
  return true;
}

export async function requireFeature(
  _feature: Feature,
  _input: { customerId?: string | null; entityId?: string } = {},
): Promise<void> {}

/** No CRM to sync new accounts into. */
export async function onUserCreated(_user: CreatedUser): Promise<void> {}

/**
 * No transactional email provider is configured in this edition, so
 * invitations are created without a mail being sent — share the link directly.
 */
export async function sendOrgInvitationEmail(
  _invitation: OrganizationInvitation,
): Promise<void> {}

/** Likewise for operator notifications such as problem reports. */
export async function sendNotificationEmail(
  _email: NotificationEmail,
): Promise<void> {}

/**
 * Likewise for password resets: Better Auth still generates the token-bearing
 * URL, but nothing delivers it. Self-hosters who need self-service reset
 * should wire their own provider here.
 */
export async function sendPasswordResetEmail(
  _email: PasswordResetEmail,
): Promise<void> {}
